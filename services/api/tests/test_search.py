"""Protocol/state fixtures, not an evaluation of a real multilingual embedding model."""
from contextlib import contextmanager
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Event, Thread
import time
from uuid import uuid4

import numpy as np
import pytest
from fastapi import HTTPException

from yorw_api.embedding import embed, normalize
from yorw_api.providers import ProbeError
from yorw_api.search import Search, SearchInput, IndexInput, split_text, tokens
from test_library import library


@pytest.fixture
def search(library):
    service = Search(library)
    yield service
    service.close()


def document(service, pages):
    identity = str(uuid4())
    with service.db.write() as conn:
        conn.execute("INSERT INTO documents(id,sha256,original_name,extraction_status,page_count,created_at,updated_at) VALUES(?,?,?,'ready',?,'time','time')", (identity,identity,'Synthetic research fixture',len(pages)))
        for number,text in enumerate(pages,1):
            chunk_id = str(uuid4())
            conn.execute('INSERT INTO chunks VALUES(?,?,1,?,?,?)', (chunk_id,identity,number-1,number,text))
            conn.execute('INSERT INTO document_blocks(id,document_id,extraction_version,ordinal,block_type,text,section_path_json,physical_page,location_json,heading_level) '
                         "VALUES(?,?,1,?,'page',?,'[]',?,?,NULL)",
                         (chunk_id,identity,number-1,text,number,json.dumps({'kind':'page','physical_page':number,'block_ordinal':number-1})))
    return identity


def config(service, version=1, model='fixture'):
    with service.db.write() as conn:
        conn.execute("INSERT INTO provider_configs(kind,base_url,model,version,updated_at) VALUES('embedding','https://example.com/v1',?,?,'time') ON CONFLICT(kind) DO UPDATE SET version=excluded.version,model=excluded.model", (model,version))


def wait(service, task):
    for _ in range(300):
        result = service.library.task(task['id'])
        if result['status'] not in ('queued','running'):
            return result
        time.sleep(.01)
    pytest.fail('Index task did not settle')


def toy_embed(config, key, texts, dimension=None):
    # Deliberate semantic labels test routing/ranking only. Never report as model quality.
    result = []
    for text in texts:
        if any(word in text.casefold() for word in ['lung','tomography','肺部','胸部']):
            vector = [1.,0.,0.]
        elif any(word in text.casefold() for word in ['pressure','trial','降压','血压','药物']):
            vector = [0.,1.,0.]
        else:
            vector = [0.,0.,1.]
        result.append(normalize(vector,dimension))
    return result


def test_chunks_are_exact_substrings_bounded_overlapping_and_chinese_is_searchable(search):
    text = ('A paragraph about lung nodules.\n\n' * 100) + '中文检索验证。'
    pieces = list(split_text(text))
    assert len(pieces) > 2 and all(text[start:end] == body and len(body) <= 1000 for start,end,body in pieces)
    assert pieces[-1][1] == len(text)
    assert all(pieces[i+1][0] <= pieces[i][1] for i in range(len(pieces)-1))
    assert tokens('中文检索') == ['中文','文检','检索']
    identity = document(search,['训练集包含一百名患者。模型使用独立验证集检查泛化能力。',text])
    result = search.query(identity,SearchInput(query='训练集'), '')
    assert result['mode'] == 'keyword' and result['items'][0]['physical_page'] == 1
    for item in result['items']:
        parent = search.library.rows('SELECT text FROM chunks WHERE id=?', (item['chunk_id'],))[0]['text']
        assert item['text'] == parent[item['start_offset']:item['end_offset']]
    assert search.status(identity)['segments'] > 2
    # Operators/punctuation are data, not executable FTS query syntax.
    assert search.query(identity,SearchInput(query='" OR * (NEAR) : --'), '')['mode'] == 'keyword'


def test_twelve_fixed_questions_scope_hybrid_and_reopen(search,monkeypatch):
    monkeypatch.setattr('yorw_api.search.embed',toy_embed)
    from pathlib import Path
    fixture = json.loads((Path(__file__).parent / 'fixtures/retrieval.json').read_text(encoding='utf-8'))
    identity = document(search,fixture['documents']['A'] + ['训练集包含一百名患者。模型使用独立验证集检查泛化能力。'])
    other = document(search,fixture['documents']['B'])
    config(search)
    task = wait(search, search.start(identity,IndexInput(semantic=True,config_version=1),'fixture-key'))
    assert task['status'] == 'succeeded'
    for case in fixture['cases']:
        query, page, semantic = case['query'], case['expected_page'], case['category']=='zh_to_en'
        result = search.query(identity,SearchInput(query=query,semantic=semantic,config_version=1),'fixture-key')
        assert all(item['document_id'] == identity for item in result['items'])
        assert (result['items'][0]['physical_page'] if result['items'] else None) == page
    assert search.query(other,SearchInput(query='survival'), '')['items']
    from yorw_api.storage.database import Database
    from yorw_api.library import Library
    # No queued jobs remain: a new connection/service reads durable vectors and FTS.
    database = Database(search.library.workspace)
    reopened_library = Library(database)
    reopened = Search(reopened_library)
    try:
        assert reopened.status(identity)['semantic_ready']
        assert reopened.query(identity,SearchInput(query='lung'), '')['items']
    finally:
        reopened.close(); reopened_library.close(); database.close()


def test_failed_rebuild_keeps_previous_generation_and_config_change_disables_it(search,monkeypatch):
    identity = document(search,['Computed tomography detects lung nodules.'])
    config(search)
    monkeypatch.setattr('yorw_api.search.embed',toy_embed)
    assert wait(search,search.start(identity,IndexInput(semantic=True,config_version=1),'key'))['status']=='succeeded'
    previous = search.library.document(identity)['active_index_generation']
    def failed(*args): raise ProbeError('RATE_LIMITED')
    monkeypatch.setattr('yorw_api.search.embed',failed)
    assert wait(search,search.start(identity,IndexInput(semantic=True,config_version=1),'key'))['stage']=='RATE_LIMITED'
    assert search.library.document(identity)['active_index_generation'] == previous
    assert search.status(identity)['semantic_ready']
    fallback = search.query(identity,SearchInput(query='lung',semantic=True,config_version=1),'key')
    assert fallback['reason']=='RATE_LIMITED' and fallback['mode']=='keyword'
    config(search,2)
    assert not search.status(identity)['semantic_ready']
    assert search.query(identity,SearchInput(query='lung',semantic=True,config_version=2),'key')['reason']=='INDEX_NOT_READY'
    assert search.query(identity,SearchInput(query='lung',semantic=True,config_version=1),'key')['reason']=='CONFIG_CHANGED'


@pytest.mark.parametrize('action',['cancel','delete','config','extraction'])
def test_inflight_rebuild_cannot_publish_after_invalidation(search,monkeypatch,action):
    identity = document(search,['Computed tomography detects lung nodules.'])
    config(search)
    entered, release = Event(),Event()
    def delayed(*args):
        entered.set(); release.wait(5)
        return toy_embed(*args)
    monkeypatch.setattr('yorw_api.search.embed',delayed)
    task = search.start(identity,IndexInput(semantic=True,config_version=1),'key')
    assert entered.wait(3)
    if action=='cancel': search.cancel(task['id'])
    elif action=='delete': search.library.remove(identity,1)
    elif action=='config': config(search,2)
    else:
        with search.db.write() as conn: conn.execute('UPDATE documents SET extraction_version=2 WHERE id=?',(identity,))
    release.set()
    for _ in range(100):
        if not search.library.rows('SELECT id FROM index_generations'): break
        time.sleep(.02)
    assert search.library.document(identity,deleted=True)['active_index_generation'] is None
    assert search.library.rows('SELECT * FROM embeddings') == []
    if action=='delete':
        assert search.library.rows('SELECT * FROM chunks_fts') == []
        with pytest.raises(HTTPException): search.query(identity,SearchInput(query='lung'),'')


def test_missing_config_key_and_dimension_failure_explicitly_fall_back(search,monkeypatch):
    identity = document(search,['lung nodules'])
    assert search.query(identity,SearchInput(query='lung',semantic=True),'')['reason']=='CONFIG_MISSING'
    config(search)
    assert search.query(identity,SearchInput(query='lung',semantic=True,config_version=1),'')['reason']=='KEY_MISSING'
    monkeypatch.setattr('yorw_api.search.embed',toy_embed)
    wait(search,search.start(identity,IndexInput(semantic=True,config_version=1),'key'))
    def wrong_dimension(*args): raise ProbeError('DIMENSION_CHANGED')
    monkeypatch.setattr('yorw_api.search.embed',wrong_dimension)
    result = search.query(identity,SearchInput(query='lung',semantic=True,config_version=1),'key')
    assert result['mode']=='keyword' and result['reason']=='DIMENSION_CHANGED'
    assert all(item['methods']==['keyword'] for item in result['items'])
    search.start(identity,IndexInput(), '')
    assert not search.status(identity)['semantic_ready']
    assert search.library.rows('SELECT * FROM embeddings')==[]


@contextmanager
def upstream(response):
    received = []
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def do_POST(self):
            received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            self.send_response(200); self.end_headers(); self.wfile.write(json.dumps(response).encode())
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=Thread(target=server.serve_forever,daemon=True); thread.start()
    try: yield f'http://127.0.0.1:{server.server_port}',received
    finally: server.shutdown(); server.server_close()


def test_embedding_protocol_validates_batch_order_count_finiteness_and_dimensions():
    with upstream({'data':[{'index':1,'embedding':[0,3]},{'index':0,'embedding':[2,0]}]}) as (url,received):
        vectors=embed({'base_url':url,'model':'fixture'},'fixture-key',['first','second'])
        assert vectors[0].tolist()==[1.,0.] and vectors[1].tolist()==[0.,1.]
        assert received[0]['input']==['first','second']
    for response in [ {'data':[{'index':0,'embedding':[0,0]}]}, {'data':[{'index':0,'embedding':[float('nan'),1]}]}, {'data':[{'index':1,'embedding':[1,0]}]}, {'data':[]} ]:
        with upstream(response) as (url,_), pytest.raises(ProbeError):
            embed({'base_url':url,'model':'fixture'},'key',['x'])
    with pytest.raises(ProbeError,match='DIMENSION_CHANGED'):
        normalize([1,0,0],2)


def test_keyword_or_semantic_match_is_enough_and_neither_returns_empty(search, monkeypatch):
    identity = document(search, ['alpha lung imaging', 'beta drug trial'])
    config(search)
    def controlled(config, key, texts, dimension=None):
        vectors = {'alpha lung imaging': [1., 0., 0.], 'beta drug trial': [0., 1., 0.],
                   '无关问题': [.2, .1, .97], '相关问题': [.9, .2, .3], 'alpha': [.2, .1, .97]}
        return [normalize(vectors[text], dimension) for text in texts]
    monkeypatch.setattr('yorw_api.search.embed', controlled)
    assert wait(search, search.start(identity, IndexInput(semantic=True, config_version=1), 'key'))['status'] == 'succeeded'
    def query(text, minimum=.5):
        return search.query(identity, SearchInput(query=text, semantic=True, config_version=1, min_similarity=minimum), 'key')
    unrelated = query('无关问题')
    assert unrelated['mode'] == 'hybrid' and unrelated['reason'] is None
    assert unrelated['items'] == [] and 0 < unrelated['best_similarity'] < .5
    related = query('相关问题')
    assert len(related['items']) == 1 and related['items'][0]['physical_page'] == 1
    assert related['items'][0]['similarity'] > .9
    assert related['items'][0]['methods'] == ['semantic']
    # Explicit exploratory cutoff restores weak candidates; default never backfills to top-k.
    assert len(query('无关问题', 0)['items']) == 2
    custom = query('相关问题', .255)
    assert custom['min_similarity'] == .255 and len(custom['items']) == 1
    keyword = query('alpha')
    # Keyword success OR semantic cutoff success admits a candidate.
    assert len(keyword['items']) == 1 and keyword['best_similarity'] < .5
    assert keyword['items'][0]['methods'] == ['keyword']
    assert keyword['items'][0]['similarity'] < keyword['min_similarity']
    assert search.query(identity, SearchInput(query='alpha'), '')['items']
    lowered = query('alpha', .15)
    assert len(lowered['items']) == 1
    assert lowered['items'][0]['methods'] == ['keyword', 'semantic']
    assert lowered['items'][0]['similarity'] >= .15
    assert all(item['similarity'] >= related['min_similarity'] for item in related['items'])
    # Explicit keyword fallback still works, but never claims to apply a cosine cutoff.
    fallback = search.query(identity, SearchInput(query='alpha', semantic=True, config_version=1), '')
    assert fallback['mode'] == 'keyword' and fallback['reason'] == 'KEY_MISSING'
    assert fallback['items'][0]['similarity'] is None
    assert query('相关问题', 1)['items'] == []
    from pydantic import ValidationError
    for minimum in [float('nan'), float('inf'), -.1, 1.1, True, '0.5']:
        with pytest.raises(ValidationError):
            SearchInput(query='x', min_similarity=minimum)

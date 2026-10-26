import time
import json
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from uuid import uuid4
import pytest
from test_chat_service import provider
from test_search_service import running,ROOT
from test_library import pdf_bytes

@pytest.mark.parametrize('frozen',[False,True])
def test_selected_materials_sse_draft_restart_without_body_overwrite(frozen,tmp_path):
    if frozen and not (ROOT/'dist/yorw-api/yorw-api.exe').exists():pytest.skip('Build backend first')
    workspace=tmp_path/'workspace'
    with provider() as (url,received):
        with running(frozen,workspace) as (request,upload):
            assert request('/v1/health')['schema_version']==11
            doc=upload(pdf_bytes())
            selected=request(f'/v1/documents/{doc}/search','POST',{'query':'English'})['items'][0]
            note=request('/v1/notes','POST',{'id':str(uuid4()),'document_id':doc,'body_md':'个人观点，不是原文结论。'})
            topic=request('/v1/topics','POST',{'id':str(uuid4()),'title':'Research wiki','parent_id':None})
            tid=topic['topic']['id']
            request('/v1/providers/chat','PUT',{'base_url':url,'model':'fixture','version':0})
            payload={'base_revision_id':topic['revision']['id'],'instruction':'整理本轮材料','materials':[{'kind':'document','id':doc,'version':str(selected['extraction_version']),'segment_ids':[selected['segment_id']]},{'kind':'note','id':note['id'],'version':'1','segment_ids':[]}]}
            preview=request(f'/v1/topics/{tid}/materials/preview','POST',payload)
            assert preview['sources'][1]['evidence']==[]
            args={**payload,'request_id':str(uuid4()),'config_version':1}
            suggestion=request(f'/v1/topics/{tid}/suggestions','POST',args,'fixture-key')
            for _ in range(150):
                suggestion=request(f'/v1/topics/{tid}/suggestions')['items'][0]
                if suggestion['status']!='running':break
                time.sleep(.02)
            assert suggestion['status']=='completed'
            assert request(f'/v1/topics/{tid}')==topic
            assert request(f'/v1/topics/{tid}/suggestions','POST',args,'fixture-key')['id']==suggestion['id']
            assert len(received)==1
            evidence=__import__('json').loads(received[0][1]['messages'][1]['content'])['evidence']
            assert evidence[0]['text']==selected['text'] and evidence[1]['kind']=='note'
            assert evidence[0]['evidence'][0]['quote']==selected['text']
        with running(frozen,workspace) as (request,_):
            restored=request(f'/v1/topics/{tid}/suggestions')['items'][0]
            assert restored['body_md']==suggestion['body_md'] and restored['status']=='completed'
            assert request(f'/v1/topics/{tid}')==topic
            request('/v1/notes/'+note['id'],'PATCH',{'body_md':'updated','version':1})
            stale=request(f'/v1/topics/{tid}/suggestions')['items'][0]
            assert stale['sources'][1]['excerpt']=='个人观点，不是原文结论。' and not stale['sources'][1]['available']


@contextmanager
def truncated_provider(second_finish):
    received = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
            first = len(received) == 1
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            text = '# Retained draft\n\nPartial [S1].' if first else ' Continuation [S1].'
            events = [{'choices': [{'delta': {'content': text}}]},
                      {'choices': [{'delta': {}, 'finish_reason': 'length' if first else second_finish}]}]
            self.wfile.write((''.join('data: ' + json.dumps(event) + '\n\n' for event in events) + 'data: [DONE]\n\n').encode())

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', received
    finally:
        server.shutdown()
        server.server_close()


@pytest.mark.parametrize('frozen', [False, True])
@pytest.mark.parametrize('second_finish', ['stop', 'length'])
def test_real_sse_continuation_restart_and_manual_recovery(frozen, second_finish, tmp_path):
    if frozen and not (ROOT/'dist/yorw-api/yorw-api.exe').exists():
        pytest.skip('Build backend first')
    workspace = tmp_path/'workspace'
    with truncated_provider(second_finish) as (url, received):
        with running(frozen, workspace) as (request, upload):
            doc = upload(pdf_bytes())
            selected = request(f'/v1/documents/{doc}/search', 'POST', {'query': 'English'})['items'][0]
            topic = request('/v1/topics', 'POST', {'id': str(uuid4()), 'title': 'Recovery', 'parent_id': None})
            tid = topic['topic']['id']
            request('/v1/providers/chat', 'PUT', {'base_url': url, 'model': 'fixture', 'version': 0})
            args = {'base_revision_id': topic['revision']['id'], 'instruction': 'Organize facts',
                    'materials': [{'kind': 'document', 'id': doc, 'version': '1', 'segment_ids': [selected['segment_id']]}],
                    'request_id': str(uuid4()), 'config_version': 1}
            suggestion = request(f'/v1/topics/{tid}/suggestions', 'POST', args, 'fixture-key')
            for _ in range(200):
                item = request(f'/v1/topics/{tid}/suggestions')['items'][0]
                if item['status'] != 'running':
                    break
                time.sleep(.02)
            assert item['status'] == ('completed' if second_finish == 'stop' else 'partial')
            assert item['body_md'] == '# Retained draft\n\nPartial [S1]. Continuation [S1].'
            assert request(f'/v1/topics/{tid}') == topic
            assert len(received) == 2 and all(p['max_tokens'] == 8192 for p in received)
            assert received[1]['messages'][2]['content'] == '# Retained draft\n\nPartial [S1].'
            assert received[0]['messages'][:2] == received[1]['messages'][:2]
            assert 'fixture-key' not in json.dumps(received)
        with running(frozen, workspace) as (request, _):
            restored = request(f'/v1/topics/{tid}/suggestions')['items'][0]
            assert restored['status'] == item['status'] and restored['body_md'] == item['body_md']
            assert restored['recoverable'] == (second_finish == 'length')
            decision = {'request_id': str(uuid4()), 'base_revision_id': topic['revision']['id'],
                        'body_md': '# Reviewed\n\nManually completed evidence [S1].'}
            saved = request(f"/v1/suggestions/{suggestion['id']}/accept", 'POST', decision)
            assert saved['view']['revision']['ordinal'] == 2
            assert saved['view']['revision']['body_md'] == decision['body_md']
            assert request(f"/v1/suggestions/{suggestion['id']}/accept", 'POST', decision) == saved
            retained = request(f'/v1/topics/{tid}/suggestions')['items'][0]
            assert retained['status'] == item['status'] and retained['body_md'] == item['body_md']
            assert len(received) == 2

"""Fixed synthetic retrieval comparison; no network or model-quality claims."""
import argparse
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
from xml.sax.saxutils import escape
from zipfile import ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/api/src'))
from yorw_api.library import Library
from yorw_api.retrieval import Retriever
from yorw_api.storage.database import Database
from yorw_api.storage.workspace import Workspace


def payload(doc):
    text = doc['text']
    if doc['format'] == 'docx':
        data = BytesIO()
        with ZipFile(data, 'w') as archive:
            archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + escape(text) + '</w:t></w:r></w:p></w:body></w:document>')
        return data.getvalue()
    if doc['format'] == 'pdf':
        from pypdf import PdfWriter
        from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
        writer = PdfWriter()
        page = writer.add_blank_page(600, 800)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(('BT /F1 10 Tf 20 700 Td (' + text + ') Tj ET').encode('ascii'))
        page[NameObject('/Contents')] = writer._add_object(stream)
        data = BytesIO(); writer.write(data)
        return data.getvalue()
    return text.encode('utf-8')


def evaluate(mode, corpus):
    cache = Path(__file__).resolve().parents[1] / '.cache'
    cache.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='yorw-eval-', dir=cache) as folder:
        db = Database(Workspace(Path(folder).resolve()))
        library = Library(db)
        try:
            identities = {}
            for doc in corpus['documents']:
                result = library.import_document(BytesIO(payload(doc)), doc['id'] + '.' + doc['format'])
                task = result['task']
                deadline = time.monotonic() + 15
                while library.task(task['id'])['status'] in ('queued', 'running'):
                    if time.monotonic() > deadline: raise RuntimeError('import timeout')
                    time.sleep(.01)
                identity = result['document']['id']
                assert library.document(identity)['extraction_status'] in ('ready', 'partial')
                identities[doc['id']] = identity
            retriever = Retriever(SimpleNamespace(db=db, library=library))
            if mode == 'metadata':
                for doc in corpus['documents']:
                    identity = identities[doc['id']]
                    current = library.document(identity)
                    blocks = library.blocks(identity)
                    with db.write() as conn:
                        conn.execute('INSERT INTO document_enrichments(document_id,extraction_version,config_hash,prompt_version,result_json,coverage_json,created_at) VALUES(?,?,?,?,?,?,?)',
                            (identity,current['extraction_version'],'authored-fixture','fixture',json.dumps({**doc['metadata'], 'evidence_ids':[b['id'] for b in blocks]}),json.dumps([b['id'] for b in blocks]),'fixture'))
            inverse = {v:k for k,v in identities.items()}
            rows = []
            for question in corpus['questions']:
                scope = {'mode':'topic','document_ids':[identities[k] for k in question['scope']], 'note_ids':[], 'wiki_topic_ids':[]} if question['scope'] else None
                start = time.perf_counter()
                options = {} if mode == 'baseline' else {'strategy':mode}
                result = retriever.retrieve(question['query'], scope=scope, semantic=False, **options)
                found = [inverse[x['object_id']] for x in result['items']]
                expected = question['expected']
                rank = next((i for i,k in enumerate(found,1) if k in expected),None)
                rows.append({'id':question['id'],'subset':question['subset'],'expected':expected,'found':found,'recall':len(set(expected)&set(found))/len(expected) if expected else None,'rr':1/rank if rank else 0,'scope_violations':sum(k not in question['scope'] for k in found) if question['scope'] else 0,'false_positive':bool(found) and not expected,'evidence_violations':sum(not hit['source']['evidence'] or any(e['document_id']!=hit['object_id'] or e['quote'] not in next(d['text'] for d in corpus['documents'] if d['id']==inverse[hit['object_id']]) for e in hit['source']['evidence']) for hit in result['items']),'latency_ms':round((time.perf_counter()-start)*1000,3)})
            positive = [r for r in rows if r['expected']]
            meta = [r for r in positive if r['subset']=='metadata']
            return {'mode':mode,'recall_at_5':sum(r['recall'] for r in positive)/len(positive),'mrr_at_5':sum(r['rr'] for r in positive)/len(positive),'metadata_recall_at_5':sum(r['recall'] for r in meta)/len(meta),'metadata_mrr_at_5':sum(r['rr'] for r in meta)/len(meta),'scope_violations':sum(r['scope_violations'] for r in rows),'no_answer_false_positives':sum(r['false_positive'] for r in rows),'model_calls':0,'evidence_violations':sum(r['evidence_violations'] for r in rows),'latency_ms_mean':round(sum(r['latency_ms'] for r in rows)/len(rows),3),'latency_ms_p95':sorted(r['latency_ms'] for r in rows)[int(.95*(len(rows)-1))],'items':rows}
        finally:
            library.close(); db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=['baseline','keywords','metadata'], default='baseline')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    corpus_path = Path(__file__).resolve().parents[1] / 'services/api/tests/fixtures/retrieval_phase2.json'
    raw = corpus_path.read_bytes()
    result = evaluate(args.mode,json.loads(raw))
    result['corpus_sha256'] = sha256(raw).hexdigest()
    result['model_configuration'] = 'lexical-only; no embeddings/chat; authored metadata fixture, not model output'
    args.report.parent.mkdir(parents=True,exist_ok=True)
    with args.report.open('x',encoding='utf-8') as output: json.dump(result,output,ensure_ascii=False,indent=2)
    print(json.dumps({k:v for k,v in result.items() if k!='items'},ensure_ascii=False))

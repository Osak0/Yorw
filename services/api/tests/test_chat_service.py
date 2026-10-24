"""Real SSE -> persisted local HTTP -> restart -> note, using a local provider only."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import json
import time
import pytest
from test_search_service import running, ROOT
from test_library import pdf_bytes

@contextmanager
def provider(ending='done'):
    received=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            received.append((self.path,body))
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            for content in ['原文信息 ','[S1]']:
                self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':content}}]},ensure_ascii=False)+'\n\n').encode());self.wfile.flush();time.sleep(.1)
            if ending=='done':self.wfile.write(b'data: [DONE]\n\n')
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield f'http://127.0.0.1:{server.server_port}',received
    finally:server.shutdown();server.server_close()

@pytest.mark.parametrize('frozen',[False,True])
def test_chat_http_sse_restart_note_and_removed_source(frozen,tmp_path):
    if frozen and not (ROOT/'dist/yorw-api/yorw-api.exe').exists():pytest.skip('Build backend first')
    workspace=tmp_path/'workspace'
    with provider() as (url,received):
        with running(frozen,workspace) as (request,upload):
            doc=upload(pdf_bytes())
            result=request(f'/v1/documents/{doc}/search','POST',{'query':'English'})
            source=result['items'][0]
            request('/v1/providers/chat','PUT',{'base_url':url,'model':'fixture','version':0})
            message=request(f'/v1/documents/{doc}/chat','POST',{'question':'What does the evidence say?','segment_ids':[source['segment_id']],'config_version':1},'fixture-key')
            for _ in range(150):
                message=request(f'/v1/documents/{doc}/chat')['items'][0]
                if message['status']!='running':break
                time.sleep(.02)
            assert message['status']=='completed' and message['body_md']=='原文信息 [S1]'
            assert received[0][0]=='/chat/completions'
            payload=received[0][1]
            assert payload['stream'] and payload['model']=='fixture'
            assert json.loads(payload['messages'][1]['content'])['evidence'][0]['text']==source['text']
            assert 'fixture-key' not in json.dumps(payload)
            note=request('/v1/chat/'+message['id']+'/note','POST',{})
        with running(frozen,workspace) as (request,_):
            restored=request(f'/v1/documents/{doc}/chat')['items'][0]
            assert restored['status']=='completed' and restored['citations']==[1]
            notes=request('/v1/notes?document_id='+doc)['items']
            assert notes[0]['id']==note['id'] and notes[0]['sources'][0]['chunk_id']==source['chunk_id']
            version=request('/v1/documents/'+doc)['version']
            request(f'/v1/documents/{doc}?version={version}','DELETE')
            assert request(f'/v1/documents/{doc}/chat')['items'][0]['sources'][0]['available'] is False
            assert request('/v1/notes?document_id='+doc)['items'][0]['sources'][0]['available'] is False

def test_sse_eof_without_done_is_not_completion():
    from yorw_api.chat import stream
    from yorw_api.providers import ProbeError
    with provider('eof') as (url,_):
        with pytest.raises(ProbeError,match='STREAM_INTERRUPTED'):
            list(stream({'base_url':url,'model':'fixture'},'key','q',[]))

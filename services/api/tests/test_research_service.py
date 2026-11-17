import json
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from uuid import uuid4
import pytest
from test_search_service import running
from test_library import pdf_bytes


@pytest.mark.parametrize('frozen',[False,True])
def test_research_http_tool_cycle_persistence_and_no_automatic_restart(frozen,tmp_path):
    count=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            count.append(1)
            results=[m for m in payload['messages'] if m['role']=='tool']
            actual='handle' in next(t for t in payload['tools'] if t['function']['name']=='read_local')['function']['parameters']['properties']
            if len(results)<2:
                name='search_local' if not results else 'read_local'
                args={'query':'fixture'} if not results else ({'handle':json.loads(results[0]['content'])['items'][0]['handle']} if actual else {'id':'fixture-1'})
                delta={'tool_calls':[{'index':0,'id':str(len(results)),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]};reason='tool_calls'
            else:delta={'content':'Original fixture [S1].' if actual else 'violet-42 [S1]'};reason='stop'
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            self.wfile.write(('data: '+json.dumps({'choices':[{'delta':delta,'finish_reason':reason}]})+'\n\ndata: [DONE]\n\n').encode())
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        workspace=tmp_path/'workspace';pid=str(uuid4())
        with running(frozen,workspace) as (request,upload):
            assert request('/v1/health')['schema_version']==29
            did=upload(pdf_bytes())
            request('/v1/providers/profiles/'+pid,'PUT',{'name':'Fixture','provider':'compatible','base_url':f'http://127.0.0.1:{server.server_port}','model':'fixture','version':0})
            check=request('/v1/providers/profiles/'+pid+'/checks/tools','POST',{},key='fixture')
            for _ in range(100):
                job=request('/v1/providers/profiles/checks/'+check['id'])
                if job['status']!='running':break
                time.sleep(.02)
            assert job['status']=='completed',job
            body={'scope':{'mode':'workspace'},'question':'Find fixture evidence','request_id':str(uuid4()),'profile_id':pid,'config_version':1}
            started=request('/v1/research/ask','POST',body,key='fixture');sid=started['session_id']
            for _ in range(100):
                view=request('/v1/research/sessions/'+sid)
                if view['items'][0]['status']!='running':break
                time.sleep(.02)
            assert view['items'][0]['status']=='completed',view
            assert view['items'][0]['sources'][0]['document_id']==did
            assert view['items'][0]['sources'][0]['available']
            assert request('/v1/research/ask','POST',body,key='fixture')==started
            assert len(request('/v1/research/sessions/'+sid+'/events')['items'])==4
            before=len(count)
        with running(frozen,workspace) as (request,_):
            view=request('/v1/research/sessions/'+sid)
            assert view['items'][0]['status']=='completed'
            assert len(count)==before
            session=view['session']
            request('/v1/research/sessions/'+sid,'PATCH',{'version':session['version'],'archived':True})
            assert request('/v1/research/sessions')['items'][0]['archived']==1
            assert len(count)==before
    finally:server.shutdown();server.server_close()

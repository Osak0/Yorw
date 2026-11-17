import json
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from uuid import uuid4
import pytest
from test_search_service import running


@pytest.mark.parametrize('frozen',[False,True])
def test_memory_http_compression_pause_export_and_restart(frozen,tmp_path):
    calls=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append(body)
            data=json.loads(body['messages'][-1]['content'])
            identity=data['events'][-1]['id']
            answer=json.dumps({'entries':[{'text':'Owned candidate, not a completed experiment','event_ids':[identity]}]})
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':answer},'finish_reason':'stop'}]})+'\n\ndata: [DONE]\n\n').encode())
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);Thread(target=server.serve_forever,daemon=True).start()
    workspace=tmp_path/'workspace';topic=str(uuid4());pid=str(uuid4())
    try:
        with running(frozen,workspace) as (request,upload):
            assert request('/v1/health')['schema_version']==29
            request('/v1/topics','POST',{'id':topic,'title':'Owned research','parent_id':None})
            request('/v1/providers/profiles/'+pid,'PUT',{'name':'Owned memory fixture','provider':'compatible','base_url':f'http://127.0.0.1:{server.server_port}','model':'owned','version':0})
            settings=request('/v1/research-memory/preferences')
            request('/v1/research-memory/preferences','PUT',{**settings,'event_threshold':1})
            result=request('/v1/research-memory/'+topic+'/compress','POST',{'profile_id':pid,'config_version':1},key='owned-fixture')
            assert result['started']
            for _ in range(100):
                view=request('/v1/research-memory/'+topic)
                if view['summary_version']:break
                time.sleep(.03)
            assert view['mode']=='model' and view['entries'][0]['certainty']=='candidate'
            assert view['entries'][0]['progress']['status']=='模型整理，待核对'
            assert len(calls)==1 and all(m['role'] in ('system','user') for m in calls[0]['messages'])
            entry=view['entries'][0]
            view=request('/v1/research-memory/'+topic,'PATCH',{'version':view['content_version'],'action':'forget','entry_id':entry['id']})
            assert not view['entries']
            request('/v1/research-memory/'+topic+'/export','POST',{})
            assert 'Owned candidate' not in (workspace/'research/topics'/topic/'Research.md').read_text(encoding='utf-8')
            assert '专题修订' in (workspace/'research/topics'/topic/'Log.md').read_text(encoding='utf-8')
            settings=request('/v1/research-memory/preferences')
            request('/v1/research-memory/preferences','PUT',{**settings,'enabled':False})
        with running(frozen,workspace) as (request,upload):
            assert not request('/v1/research-memory/'+topic)['entries']
            assert not request('/v1/research-memory/preferences')['enabled']
            assert request('/v1/research-memory/pending')['items']==[]
            assert len(calls)==1
    finally:server.shutdown();server.server_close()

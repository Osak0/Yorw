import json
import time
from threading import Event
from uuid import uuid4
import pytest
from fastapi import FastAPI
import socket
import urllib.request
import urllib.error
from threading import Thread
import uvicorn
from test_library import library
from yorw_api.providers import router, ProbeError
from yorw_api.model_transport import tool_probe


@pytest.fixture
def client(library):
    app=FastAPI();app.include_router(router(library.db))
    sock=socket.socket();sock.bind(('127.0.0.1',0));sock.listen(10)
    port=sock.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(app,log_level='critical'))
    thread=Thread(target=lambda:server.run(sockets=[sock]),daemon=True);thread.start()
    for _ in range(200):
        if server.started:break
        time.sleep(.01)
    class Client:
        def call(self,method,path,json=None,headers=None):
            data=__import__('json').dumps(json).encode() if json is not None else None
            request=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=data,method=method,headers={'Content-Type':'application/json',**(headers or {})})
            try:response=urllib.request.urlopen(request,timeout=5)
            except urllib.error.HTTPError as error:response=error
            class Result:
                status_code=response.code
                text=response.read().decode()
                def json(self):return __import__('json').loads(self.text)
            response.close();return Result()
        def get(self,path,**kw):return self.call('GET',path,**kw)
        def put(self,path,**kw):return self.call('PUT',path,**kw)
        def post(self,path,**kw):return self.call('POST',path,**kw)
        def delete(self,path,**kw):return self.call('DELETE',path,**kw)
    try:yield Client()
    finally:server.should_exit=True;thread.join(5);sock.close()


def create(client):
    identity=str(uuid4())
    body={'name':'Fixture','provider':'deepseek','base_url':'https://api.deepseek.com','model':'fixture','version':0}
    response=client.put('/v1/providers/profiles/'+identity,json=body)
    assert response.status_code==200,response.text
    return identity,body


def test_profiles_defaults_conflicts_and_old_config_independent(client):
    identity,body=create(client)
    root='/v1/providers/profiles'
    assert client.put(root+'/'+identity,json=body).status_code==409
    assert client.put('/v1/providers/chat',json={'base_url':'https://api.deepseek.com','model':'old','version':0}).status_code==200
    values=client.get(root).json()
    assert values['items'][0]['model']=='fixture'
    defaults=values['defaults']
    assert client.put(root+'/defaults',json={**defaults,'research_id':identity}).status_code==200
    assert client.put(root+'/defaults',json=defaults).status_code==409
    assert client.delete(root+'/'+identity+'?version=2').status_code==409
    assert client.delete(root+'/'+identity+'?version=1').status_code==200
    assert client.get(root).json()['defaults']['research_id'] is None
    assert client.get('/v1/providers').json()['items'][0]['model']=='old'


def test_check_records_and_config_invalidation(client,monkeypatch):
    identity,body=create(client)
    import yorw_api.model_profiles as module
    monkeypatch.setattr(module,'tool_probe',lambda *args,**kwargs:{'ok':True,'code':'TOOLS_CONNECTED','turns':3})
    root='/v1/providers/profiles'
    r=client.post(root+'/'+identity+'/checks/tools',headers={'x-provider-key':'fixture-secret'})
    assert r.status_code==200,r.text
    job_id=r.json()['id']
    for _ in range(100):
        job=client.get(root+'/checks/'+job_id).json()
        if job['status']!='running':break
        time.sleep(.01)
    assert job['status']=='completed'
    item=client.get(root).json()['items'][0]
    assert json.loads(item['tools_check'])['ok']
    assert 'fixture-secret' not in json.dumps(item)
    updated=client.put(root+'/'+identity,json={**body,'version':1}).json()
    assert updated['tools_check'] is None


def test_cancel_does_not_publish_success(client,monkeypatch):
    identity,_=create(client)
    import yorw_api.model_profiles as module
    gate=Event()
    def slow(*args,**kwargs):
        gate.wait(2)
        return {'ok':True,'code':'TOOLS_CONNECTED'}
    monkeypatch.setattr(module,'tool_probe',slow)
    root='/v1/providers/profiles'
    job=client.post(root+'/'+identity+'/checks/tools',headers={'x-provider-key':'fixture'}).json()['id']
    assert client.post(root+'/'+identity+'/checks/chat',headers={'x-provider-key':'fixture'}).status_code==409
    client.post(root+'/checks/'+job+'/cancel')
    gate.set();time.sleep(.05)
    assert client.get(root+'/checks/'+job).json()['status']=='cancelled'
    assert client.get(root).json()['items'][0]['tools_check'] is None


def test_owned_search_read_citation_and_no_retries():
    calls=[]
    def turn(config,key,messages,tools,validators,stop,deadline,max_tokens):
        calls.append(json.loads(json.dumps(messages)))
        ordinal=len(calls)
        if ordinal<3:
            name,args=('search_local',{'query':'token'}) if ordinal==1 else ('read_local',{'id':'fixture-1'})
            return {'role':'assistant','content':'','reasoning_content':'retained','tool_calls':[{'id':str(ordinal),'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]},[(str(ordinal),name,validators[name](args))],None
        return {'role':'assistant','content':'violet-42 [S1]'},[],None
    result=tool_probe({},'key',turn_fn=turn)
    assert result['turns']==3 and result['tool_calls']==2
    assert calls[1][-2]['reasoning_content']=='retained'
    assert calls[2][-1]['tool_call_id']=='2'
    assert all('violet-42' not in str(m) for m in calls[0])
    stop=Event();stop.set()
    with pytest.raises(ProbeError) as error:tool_probe({},'key',stop=stop,turn_fn=turn)
    assert error.value.code=='CANCELLED' and len(calls)==3


def test_repeated_tool_and_missing_proof_stop():
    def repeat(*args):return {'role':'assistant','content':''},[('a','search_local',{'query':'token'})],None
    with pytest.raises(ProbeError) as error:tool_probe({},'key',turn_fn=repeat)
    assert error.value.code=='REPEATED_TOOL_CALL'
    with pytest.raises(ProbeError) as error:tool_probe({},'key',turn_fn=lambda *a:({'role':'assistant','content':'guess'},[],None))
    assert error.value.code=='TOOL_PROOF_MISSING'


def test_schema24_upgrade_copies_chat_without_secrets_and_is_repeatable(tmp_path):
    import shutil
    from yorw_api.storage.database import Database
    from yorw_api.storage.workspace import Workspace
    migrations=tmp_path/'migrations';migrations.mkdir()
    source=__import__('pathlib').Path(__file__).resolve().parents[1]/'src/yorw_api/migrations'
    for file in source.glob('*.sql'):
        if int(file.name.split('_')[0])<=24:shutil.copyfile(file,migrations/file.name)
    workspace=Workspace(tmp_path/'old')
    db=Database(workspace,migrations)
    with db.write() as conn:conn.execute("INSERT INTO provider_configs(kind,base_url,model,version,updated_at) VALUES('chat','https://api.deepseek.com','existing',7,'time')")
    db.close();upgraded=Database(workspace)
    assert upgraded.version==31
    assert upgraded.connection.execute('SELECT model,legacy_version FROM model_profiles').fetchall()==[('existing',7)]
    assert upgraded.connection.execute('SELECT model,version FROM provider_configs').fetchall()==[('existing',7)]
    assert list((workspace.root/'backups').glob('*.sqlite3'))
    upgraded.close();again=Database(workspace)
    assert again.connection.execute('SELECT count(*) FROM model_profiles').fetchone()[0]==1
    again.close()


@pytest.fixture
def sse_server():
    from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
    received=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            received.append(data)
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            if data['model']=='stall':
                self.wfile.flush();time.sleep(3);return
            def emit(delta,reason=None):self.wfile.write(('data: '+json.dumps({'choices':[{'delta':delta,'finish_reason':reason}]})+'\n\n').encode())
            if data['model']=='malformed':
                emit({'tool_calls':[{'index':0,'id':'bad','function':{'name':'read_local','arguments':'{'}}]},'tool_calls')
            else:
                results=[m for m in data['messages'] if m['role']=='tool']
                if len(results)<2:
                    name,args=('search_local','{"query":"token"}') if not results else ('read_local','{"id":"fixture-1"}')
                    emit({'reasoning_content':'retained','tool_calls':[{'index':0,'id':str(len(results)),'type':'function','function':{'name':name,'arguments':args[:4]}}]})
                    emit({'tool_calls':[{'index':0,'function':{'arguments':args[4:]}}]},'tool_calls')
                else:emit({'content':'violet-42 [S1]'},'stop')
            self.wfile.write(b'data: [DONE]\n\n')
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield f'http://127.0.0.1:{server.server_port}',received
    finally:server.shutdown();server.server_close()


def test_actual_sse_search_read_reference_and_invalid_arguments(sse_server):
    url,received=sse_server
    result=tool_probe({'base_url':url,'model':'fixture'},'fixture')
    assert result['turns']==3
    assert received[1]['messages'][-2]['reasoning_content']=='retained'
    before=len(received)
    with pytest.raises(ProbeError) as error:tool_probe({'base_url':url,'model':'malformed'},'fixture')
    assert error.value.code=='INVALID_TOOL_ARGUMENTS' and len(received)==before+1


def test_sse_cancellation_and_deadline_wake_blocking_read(sse_server):
    from threading import Timer
    url,_=sse_server
    stop=Event();timer=Timer(.1,stop.set);timer.start()
    started=time.monotonic()
    try:
        with pytest.raises(ProbeError) as error:tool_probe({'base_url':url,'model':'stall'},'fixture',stop=stop)
        assert error.value.code=='CANCELLED'
        assert time.monotonic()-started<2
    finally:timer.cancel()
    # Cancel returns immediately; do not start another network job until its slot settles.
    time.sleep(3.1)
    with pytest.raises(ProbeError) as error:tool_probe({'base_url':url,'model':'stall'},'fixture',timeout=.1)
    assert error.value.code=='TIMEOUT'


def test_tool_turn_count_and_input_budget_are_bounded():
    count=0
    def endless(*args):
        nonlocal count
        count+=1
        return {'role':'assistant','content':''},[(str(count),'search_local',{'query':str(count)})],None
    with pytest.raises(ProbeError) as error:tool_probe({},'key',turn_fn=endless)
    assert error.value.code=='TURN_LIMIT_EXCEEDED' and count==8
    with pytest.raises(ProbeError) as error:
        tool_probe({},'key',turn_fn=lambda *args:({'role':'assistant','content':'large'*4000},[],None))
    assert error.value.code=='TOKEN_BUDGET_EXCEEDED'


def test_config_changed_during_detection_blocks_following_tools():
    count=0
    def changed():raise ProbeError('CONFIG_CONFLICT')
    def unexpected(*args):
        nonlocal count
        count+=1
    with pytest.raises(ProbeError) as error:tool_probe({},'key',turn_fn=unexpected,check_current=changed)
    assert error.value.code=='CONFIG_CONFLICT' and count==0

"""Real HTTP and process restart checks for source and frozen builds; local fixture provider."""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request

import pytest

from test_library import pdf_bytes
from test_search import upstream

ROOT=Path(__file__).parents[1]


@contextmanager
def running(frozen,workspace):
    command=[str(ROOT/'dist/yorw-api/yorw-api.exe')] if frozen else [sys.executable,'-m','yorw_api']
    child=subprocess.Popen(command,cwd=ROOT/'src',stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        child.stdin.write(json.dumps({'token':'t'*64,'workspace_path':str(workspace)})+'\n');child.stdin.flush()
        handshake=json.loads(child.stdout.readline())
        base=f"http://127.0.0.1:{handshake['port']}"
        def request(path,method='GET',body=None,key='',binary=False):
            headers={'Authorization':'Bearer '+'t'*64,'Content-Type':'application/json'}
            if key:headers['X-Provider-Key']=key
            req=urllib.request.Request(base+path,method=method,data=json.dumps(body).encode() if body is not None else None,headers=headers)
            with urllib.request.urlopen(req,timeout=5) as response:return response.read() if binary else json.load(response)
        for _ in range(100):
            try:
                request('/v1/health');break
            except (OSError,urllib.error.URLError):time.sleep(.05)
        else:pytest.fail('Startup timed out')
        def upload(content):
            boundary='yorw-search-fixture'
            raw=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode()+content+f'\r\n--{boundary}--\r\n'.encode()
            req=urllib.request.Request(base+'/v1/documents/import',data=raw,headers={'Authorization':'Bearer '+'t'*64,'Content-Type':'multipart/form-data; boundary='+boundary})
            with urllib.request.urlopen(req,timeout=5) as response:identity=json.load(response)['document']['id']
            for _ in range(100):
                if request('/v1/documents/'+identity)['extraction_status']=='ready':return identity
                time.sleep(.05)
            pytest.fail('Fixture extraction timed out')
        yield request,upload
        child.stdin.close();assert child.wait(timeout=8)==0
    finally:
        if child.poll() is None:
            child.kill();child.wait(timeout=5)


@pytest.mark.parametrize('frozen',[False,True])
def test_keyword_vector_generation_and_restart(frozen,tmp_path):
    if frozen and not (ROOT/'dist/yorw-api/yorw-api.exe').exists():pytest.skip('Build backend first')
    workspace=tmp_path/'workspace'
    with upstream({'data':[{'index':0,'embedding':[1.,0.]}]}) as (provider,received):
        with running(frozen,workspace) as (request,upload):
            identity=upload(pdf_bytes())
            other=upload(pdf_bytes()+b'\n% distinct managed fixture\n')
            result=request(f'/v1/documents/{identity}/search','POST',{'query':'fixed English'})
            assert result['mode']=='keyword' and result['items'][0]['document_id']==identity
            assert all(item['document_id']!=other for item in result['items'])
            request('/v1/providers/embedding','PUT',{'base_url':provider,'model':'fixture','version':0})
            task=request(f'/v1/documents/{identity}/index','POST',{'semantic':True,'config_version':1},'fixture-key')
            for _ in range(100):
                task=request('/v1/tasks/'+task['id'])
                if task['status'] not in ('queued','running'):break
                time.sleep(.03)
            assert task['status']=='succeeded'
            result=request(f'/v1/documents/{identity}/search','POST',{'query':'any semantic query','semantic':True,'config_version':1},'fixture-key')
            assert result['mode']=='hybrid' and result['items'][0]['document_id']==identity
            assert request(f'/v1/documents/{identity}/index')['dimension']==2
        with running(frozen,workspace) as (request,_):
            assert request(f'/v1/documents/{identity}/index')['semantic_ready']
            assert request(f'/v1/documents/{identity}/search','POST',{'query':'English'})['items']
            document=request('/v1/documents/'+identity)
            request('/v1/documents/'+identity+'?version='+str(document['version']),'DELETE')
            with pytest.raises(urllib.error.HTTPError) as removed:
                request(f'/v1/documents/{identity}/search','POST',{'query':'English'})
            assert removed.value.code==404
        with sqlite3.connect(workspace/'yorw.sqlite3') as conn:
            assert conn.execute('SELECT count(*) FROM chunks_fts WHERE document_id=?',(identity,)).fetchone()==(0,)
            assert conn.execute('SELECT count(*) FROM embeddings').fetchone()==(0,)
            assert 'fixture-key' not in ''.join(row[0] for row in conn.execute('SELECT input_json FROM tasks'))
        assert all('fixture-key' not in json.dumps(body) for body in received)

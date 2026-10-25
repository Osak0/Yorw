"""A client which stops consuming a PDF must not keep the private service alive."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request
import pytest
from test_library import pdf_bytes

ROOT=Path(__file__).parents[1]


@pytest.mark.parametrize('frozen',[False,True])
def test_parent_eof_with_a_stalled_pdf_download(frozen,tmp_path):
    executable=ROOT/'dist/yorw-api/yorw-api.exe'
    if frozen and not executable.exists():pytest.skip('Build backend first')
    command=[str(executable)] if frozen else [sys.executable,'-m','yorw_api']
    child=subprocess.Popen(command,cwd=ROOT/'src',stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
    peer=None
    try:
        token='t'*64
        child.stdin.write(json.dumps({'token':token,'workspace_path':str(tmp_path/'workspace')})+'\n');child.stdin.flush()
        port=json.loads(child.stdout.readline())['port'];base=f'http://127.0.0.1:{port}'
        for _ in range(100):
            try:
                with urllib.request.urlopen(urllib.request.Request(base+'/v1/health',headers={'Authorization':'Bearer '+token}),timeout=1) as response:json.load(response)
                break
            except OSError:time.sleep(.05)
        else:pytest.fail('health timeout')
        content=pdf_bytes()+b'\n% '+b'A'*(12*1024*1024)
        boundary='yorw-stalled-download'
        body=(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="large.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode()+content+f'\r\n--{boundary}--\r\n'.encode()
        upload=urllib.request.Request(base+'/v1/documents/import',data=body,headers={'Authorization':'Bearer '+token,'Content-Type':'multipart/form-data; boundary='+boundary})
        with urllib.request.urlopen(upload,timeout=15) as response:identity=json.load(response)['document']['id']
        peer=socket.socket();peer.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,4096);peer.settimeout(5);peer.connect(('127.0.0.1',port))
        peer.sendall(f'GET /v1/documents/{identity}/file HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\n\r\n'.encode())
        assert b'200 OK' in peer.recv(1024)
        # Keep the socket open without draining its large response.
        child.stdin.close()
        assert child.wait(timeout=8)==0
    finally:
        if peer:peer.close()
        if child.poll() is None:child.kill()
        child.wait(timeout=5)

"""Actual private HTTP, real SSE parser, frozen runtime and restart integration."""
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from uuid import uuid4
import json
import time

import pytest

from test_library import pdf_bytes
from test_search_service import running, ROOT


@contextmanager
def ai_provider():
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            calls.append((self.path, body))
            if self.path.endswith('/embeddings'):
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'data': [{'index': i, 'embedding': [1., 0.]} for i in range(len(body['input']))]}).encode())
                return
            instruction = body['messages'][0]['content']
            data = json.loads(body['messages'][1]['content'])
            if '筛选器' in instruction:
                choices = json.loads(data['question'])['candidates']
                text = json.dumps({'items': [{'id': row['id'], 'sentence': 0} for row in choices]})
            elif '改写' in instruction:
                text = json.dumps({'query': 'English evidence'})
            elif 'Wiki 草稿助手' in instruction:
                text = '# Wiki draft\n\n' + '\n'.join(f"Evidence from {source['kind']} [{source['id']}]." for source in data['evidence'])
            else:
                text = 'English fixture evidence [S1].'
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            self.wfile.write(('data: ' + json.dumps({'choices': [{'delta': {'content': text}}]}) + '\n\ndata: ' + json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}]}) + '\n\ndata: [DONE]\n\n').encode())

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield f'http://127.0.0.1:{server.server_port}', calls
    finally:
        server.shutdown()
        server.server_close()


def submit(request, kind, target, text, base=None):
    headers = {'X-Chat-Key': 'chat-fixture-key', 'X-Embedding-Key': 'embedding-fixture-key',
               'X-Chat-Version': '1', 'X-Embedding-Version': '1'}
    # The public fixture request helper keeps the session token private; wrap a
    # single method to supply the workflow's two distinct credential headers.
    import urllib.request
    original = urllib.request.urlopen
    def urlopen(value, *args, **kwargs):
        for name, value_ in headers.items():
            value.add_header(name, value_)
        return original(value, *args, **kwargs)
    from unittest.mock import patch
    payload = {'kind': kind, 'target_id': target, 'text': text, 'request_id': str(uuid4())}
    if base:
        payload['base_revision_id'] = base
    with patch('urllib.request.urlopen', urlopen):
        task = request('/v1/ai/tasks', 'POST', payload)
    for _ in range(300):
        task = request('/v1/ai/tasks/' + task['id'])
        if task['status'] not in ('queued', 'running'):
            assert task['status'] == 'succeeded', task
            return task, payload
        time.sleep(.02)
    pytest.fail('workflow timed out')


def wait_stream(request, path, identity):
    for _ in range(200):
        item = next(row for row in request(path)['items'] if row['id'] == identity)
        if item['status'] != 'running':
            assert item['status'] == 'completed', item
            return item
        time.sleep(.02)
    pytest.fail('stream timed out')


@pytest.mark.parametrize('frozen', [False, True])
def test_one_submit_search_followup_draft_append_export_and_restart(frozen, tmp_path):
    if frozen and not (ROOT/'dist/yorw-api/yorw-api.exe').exists():
        pytest.skip('Build backend first')
    workspace = tmp_path/'workspace'
    with ai_provider() as (url, calls):
        with running(frozen, workspace) as (request, upload):
            doc = upload(pdf_bytes())
            for kind in ('chat', 'embedding'):
                request('/v1/providers/' + kind, 'PUT', {'base_url': url, 'model': 'fixture', 'version': 0})
            assert request('/v1/ai/preferences') == {'semantic_enabled': True, 'version': 1}
            search, _ = submit(request, 'search', doc, 'English evidence')
            assert search['result']['items'][0]['document_id'] == doc
            assert len(search['result']['items'][0]['snippet']) <= 220
            first, _ = submit(request, 'chat', doc, 'What is the English evidence?')
            message = wait_stream(request, f'/v1/documents/{doc}/chat', first['result']['message_id'])
            note = request('/v1/chat/' + message['id'] + '/note', 'POST', {})
            followup, _ = submit(request, 'chat', doc, '它是什么？')
            followed = wait_stream(request, f'/v1/documents/{doc}/chat', followup['result']['message_id'])
            assert followed['context']['history'][0]['question'] == message['question']
            other = request('/v1/topics', 'POST', {'id': str(uuid4()), 'title': 'Prior English knowledge', 'parent_id': None})
            request(f"/v1/topics/{other['topic']['id']}/revisions", 'POST', {'base_revision_id': other['revision']['id'], 'body_md': 'Prior English evidence synthesis.'})
            topic = request('/v1/topics', 'POST', {'id': str(uuid4()), 'title': 'English synthesis', 'parent_id': None})
            tid = topic['topic']['id']
            generated, _ = submit(request, 'draft', tid, 'Summarize English evidence', topic['revision']['id'])
            draft = wait_stream(request, f'/v1/topics/{tid}/suggestions', generated['result']['suggestion_id'])
            assert {source['kind'] for source in draft['sources']} == {'document', 'note', 'wiki'}
            assert all(source['source_object_id'] != tid for source in draft['sources'])
            decision = {'request_id': str(uuid4()), 'base_revision_id': topic['revision']['id'], 'body_md': draft['body_md'], 'apply_mode': 'append'}
            accepted = request('/v1/suggestions/' + draft['id'] + '/accept', 'POST', decision)['view']
            generated2, _ = submit(request, 'draft', tid, 'Summarize English evidence again', accepted['revision']['id'])
            draft2 = wait_stream(request, f'/v1/topics/{tid}/suggestions', generated2['result']['suggestion_id'])
            merged = request('/v1/suggestions/' + draft2['id'] + '/accept', 'POST', {'request_id': str(uuid4()), 'base_revision_id': accepted['revision']['id'], 'body_md': 'Append [S1].', 'apply_mode': 'append'})['view']
            assert merged['revision']['body_md'].startswith(accepted['revision']['body_md'])
            assert f"[S{len(accepted['revision']['sources'])+1}]" in merged['revision']['body_md']
            exported = request('/v1/exports', 'POST', {'note_ids': [note['id']], 'topic_ids': [tid]})
            assert request('/v1/exports/' + exported['task_id'] + '/file', binary=True).startswith(b'PK')
            request('/v1/ai/preferences', 'PUT', {'semantic_enabled': False, 'version': 1})
            assert not any('fixture-key' in json.dumps(body) for _, body in calls)
        count = len(calls)
        with running(frozen, workspace) as (request, _):
            assert request('/v1/ai/preferences')['semantic_enabled'] is False
            assert request('/v1/topics/' + tid) == merged
            assert request('/v1/ai/tasks/' + generated2['id'])['status'] == 'succeeded'
            assert len(calls) == count

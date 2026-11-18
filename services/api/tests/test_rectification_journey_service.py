"""R6: owned four-file directory, feedback, proposal, adoption and restart over HTTP."""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError
from uuid import uuid4

import pytest

from test_builtin_parsers import fixtures
from test_library import pdf_bytes
from test_research_journey_service import completed
from test_search_service import running


@pytest.mark.parametrize('frozen', [False, True])
def test_four_file_folder_feedback_adoption_receipt_and_restart(frozen, tmp_path):
    profile, folder, documents, received = str(uuid4()), None, [], []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            received.append(payload)
            actual = any(tool['function']['name'] == 'browse_library' for tool in payload['tools'])
            last = max(i for i, message in enumerate(payload['messages']) if message['role'] == 'user')
            results = [message for message in payload['messages'][last + 1:] if message['role'] == 'tool']
            question = payload['messages'][last]['content']
            if not actual:
                if not results:
                    name, args = 'search_local', {'query': 'fixture'}
                elif len(results) == 1:
                    name, args = 'read_local', {'id': json.loads(results[0]['content'])['items'][0]['id']}
                else:
                    name, args = None, None
            elif question == '采纳后核对实际状态':
                name, args = ('inspect_proposals', {}) if not results else (None, None)
            else:
                sequence = [
                    ('browse_library', {'page': 0}),
                    ('search_library', {'query': '新生杯', 'kind': 'folder'}),
                    ('browse_library', {'folder_id': folder, 'page_size': 2}),
                    ('browse_library', {'folder_id': folder, 'page_size': 2, 'page': 2}),
                    ('propose_changes', {'operations': [
                        {'key': 'topic', 'action': 'create_topic', 'title': '新生杯', 'reason': '用户明确要求'},
                        *[{'key': 'link' + str(index), 'action': 'link', 'first_kind': 'document',
                           'first': identity, 'second_kind': 'topic', 'second': '$topic',
                           'reason': '目录归属建议，未核对正文', 'recommended': True}
                          for index, identity in enumerate(documents)],
                        {'key': 'note', 'action': 'create_note', 'owner': '$topic', 'title': '整理范围',
                         'body_md': '关联依据为目录归属；尚未核对金额。', 'reason': '用户要求记录整理边界'},
                    ], 'dependencies': [{'folder_id': folder}]}),
                ]
                name, args = sequence[len(results)] if len(results) < len(sequence) else (None, None)
            if name:
                delta = {'tool_calls': [{'index': 0, 'id': 'r6-' + str(len(results)), 'type': 'function',
                                        'function': {'name': name, 'arguments': json.dumps(args)}}]}
                finish = 'tool_calls'
            else:
                text = 'violet-42 [S1]' if not actual else '方案待采纳，目录共有四份材料，正文金额尚未核对。'
                if actual and question == '采纳后核对实际状态':
                    proposal = json.loads(results[-1]['content'])['items'][0]
                    assert proposal['status'] == 'accepted'
                    text = '已核对采纳回执，专题与两条关联已经建立。'
                delta, finish = {'content': text}, 'stop'
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            self.wfile.write(('data: ' + json.dumps({'choices': [{'delta': delta, 'finish_reason': finish}]})
                              + '\n\ndata: [DONE]\n\n').encode())

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    workspace = tmp_path / 'workspace'
    try:
        with running(frozen, workspace) as (request, upload):
            request('/v1/library-folders', 'POST', {'name': '新生杯'})
            folder = request('/v1/library-folders')['items'][0]['id']
            for index, name in enumerate(['决算单.docx', '决算单副本.docx', '球票发票.pdf', '奖牌发票.pdf']):
                data = fixtures.docx_bytes() + bytes(index) if index < 2 else pdf_bytes() + f'\n% owned invoice {index}'.encode()
                documents.append(upload(data, name, 'application/octet-stream'))
            request('/v1/library-folder-assignment', 'POST', {'folder_id': folder, 'documents': {
                identity: request('/v1/documents/' + identity)['version'] for identity in documents}})
            request('/v1/providers/profiles/' + profile, 'PUT', {'name': 'Owned R6', 'provider': 'compatible',
                    'base_url': f'http://127.0.0.1:{server.server_port}', 'model': 'owned-r6', 'version': 0})
            job = request(f'/v1/providers/profiles/{profile}/checks/tools', 'POST', {}, key='owned-key')
            for _ in range(200):
                check = request('/v1/providers/profiles/checks/' + job['id'])
                if check['status'] != 'running':
                    break
                time.sleep(.03)
            assert check['status'] == 'completed', check
            ask = {'scope': {'mode': 'workspace'}, 'question': '从新生杯目录建立专题并建议关联材料',
                   'request_id': str(uuid4()), 'profile_id': profile, 'config_version': 1}
            start = request('/v1/research/ask', 'POST', ask, key='owned-key')
            task = completed(request, start['session_id'])
            assert task['tool_calls'][0]['status'] == 'error'
            assert all(call['status'] == 'ok' for call in task['tool_calls'][1:])
            turns = received[-6:]
            pages = [json.loads(message['content']) for message in turns[-1]['messages']
                     if message['role'] == 'tool' and json.loads(message['content']).get('result_type') == 'library']
            assert len(pages) == 2 and pages[0]['has_more'] and not pages[1]['has_more']
            assert {item['id'] for page in pages for item in page['items']} == set(documents)
            proposal = request('/v1/collaboration/proposals?task_id=' + task['id'])['items'][0]
            assert not request('/v1/topics')['items']  # preview cannot create formal assets
            selected = ['topic', 'link0', 'link1', 'note']
            decision = {'request_id': str(uuid4()), 'version': proposal['version'], 'selected': selected}
            accepted = request('/v1/collaboration/proposals/' + proposal['id'] + '/accept', 'POST', decision)
            repeated = request('/v1/collaboration/proposals/' + proposal['id'] + '/accept', 'POST', decision)
            assert repeated['decision']['records'] == accepted['decision']['records']
            topic = request('/v1/topics')['items'][0]['id']
            overview = request('/v1/topics/' + topic + '/overview')
            assert {item['id'] for item in overview['documents']} == set(documents[:2])
            note_id = overview['owned_notes'][0]['id']
            ask.update(session_id=start['session_id'], request_id=str(uuid4()), question='采纳后核对实际状态')
            request('/v1/research/ask', 'POST', ask, key='owned-key')
            assert '采纳回执' in completed(request, start['session_id'])['body_md']
            note = request('/v1/notebooks/' + note_id)
            request('/v1/topics/' + note_id + '/revisions', 'POST', {
                'base_revision_id': note['base_revision_id'], 'body_md': note['body_md'] + '\n人工补写保留。'})
            with pytest.raises(HTTPError) as conflict:
                request('/v1/collaboration/proposals/' + proposal['id'] + '/undo', 'POST', {
                    'request_id': str(uuid4()), 'version': accepted['version'], 'selected': []})
            assert json.load(conflict.value)['error']['code'] == 'UNDO_CONFLICT'
            calls = len(received)
        with running(frozen, workspace) as (request, _upload):
            assert len(received) == calls
            assert '人工补写保留' in request('/v1/notebooks/' + note_id)['body_md']
            assert request('/v1/collaboration/proposals/' + proposal['id'])['status'] == 'accepted'
            assert len(request('/v1/research/sessions/' + start['session_id'])['items']) == 2
    finally:
        server.shutdown()
        server.server_close()

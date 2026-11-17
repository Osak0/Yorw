"""Stage-six cross-topic journey over source/frozen HTTP, owned data and loopback SSE.

This checks contracts and persistence; the deterministic model is not a quality judge.
"""
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError
from uuid import uuid4

import pytest

from test_library import pdf_bytes
from test_search_service import running


def completed(request, session_id):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        view = request('/v1/research/sessions/' + session_id)
        if view['items'][-1]['status'] != 'running':
            assert view['items'][-1]['status'] == 'completed', view
            return view['items'][-1]
        time.sleep(.03)
    pytest.fail('Research journey did not finish')


@pytest.mark.parametrize('frozen', [False, True])
def test_cross_topic_correction_restart_adoption_and_conflict(frozen, tmp_path):
    owner, shared, excluded, profile = [str(uuid4()) for _ in range(4)]
    requests = []
    correction = 'Experiment has NOT run; the idea is unverified.'
    operations = [
        {'key': 'branch', 'action': 'create_topic', 'title': 'Optional experiment', 'reason': 'Separate candidate'},
        {'key': 'dependent', 'action': 'create_note', 'owner': '$branch', 'title': 'Optional protocol',
         'body_md': 'Not a completed experiment.', 'reason': 'Depends on the optional topic'},
        {'key': 'independent', 'action': 'create_note', 'owner': owner, 'title': 'Unverified idea',
         'body_md': 'Candidate hypothesis from owned evidence [S1]; experiment not run.', 'reason': 'User review required'},
    ]

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            requests.append(payload)
            tools = {t['function']['name']: t['function'] for t in payload['tools']}
            actual = 'handle' in tools['read_local']['parameters']['properties']
            # Only current-turn results: continued sessions also contain old dialogue.
            last_question = max(i for i, m in enumerate(payload['messages'])
                                if m['role'] == 'user')
            results = [m for m in payload['messages'][last_question + 1:] if m['role'] == 'tool']
            if not results:
                name, args = 'search_local', {'query': 'fixture'}
            elif len(results) == 1:
                items = json.loads(results[0]['content'])['items']
                if actual:
                    item = next(i for i in items if i['kind'] == 'document')
                    args = {'handle': item['handle']}
                else:
                    args = {'id': 'fixture-1'}
                name = 'read_local'
            elif actual and len(results) == 2:
                name, args = 'propose_changes', {'operations': json.dumps(operations)}
            else:
                name, args = None, None
            if name:
                delta = {'tool_calls': [{'index': 0, 'id': 'journey-' + str(len(results)), 'type': 'function',
                                        'function': {'name': name, 'arguments': json.dumps(args)}}]}
                reason = 'tool_calls'
            else:
                delta = {'content': 'Unverified idea, experiment not run [S1].' if actual else 'violet-42 [S1]'}
                reason = 'stop'
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.end_headers()
            self.wfile.write(('data: ' + json.dumps({'choices': [{'delta': delta, 'finish_reason': reason}]})
                              + '\n\ndata: [DONE]\n\n').encode())

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    workspace = tmp_path / 'workspace'
    try:
        with running(frozen, workspace) as (request, upload):
            for identity, title in [(owner, 'Current question'), (shared, 'Shared evidence'), (excluded, 'Excluded branch')]:
                request('/v1/topics', 'POST', {'id': identity, 'title': title, 'parent_id': None})
            document = upload(pdf_bytes())
            hidden_document = upload(pdf_bytes() + b'\n% excluded owned fixture\n')
            request(f'/v1/documents/{document}/topics/{shared}', 'PUT', {})
            request(f'/v1/documents/{hidden_document}/topics/{excluded}', 'PUT', {})
            note_id = str(uuid4())
            note = request(f'/v1/topics/{shared}/notebooks', 'POST', {'id': note_id, 'title': 'Shared fixture observation'})
            request(f'/v1/topics/{note_id}/revisions', 'POST',
                    {'base_revision_id': note['base_revision_id'], 'body_md': 'fixture observation, not measured results'})
            scope = request(f'/v1/topics/{owner}/note-scope')
            request(f'/v1/topics/{owner}/note-scope', 'PUT',
                    {'version': scope['version'], 'rules': {owner: True, shared: True, excluded: False}})
            overview = request(f'/v1/topics/{owner}/overview')
            assert note_id in {n['id'] for n in overview['notes']}
            assert {d['id'] for d in overview['documents']} == {document}
            request('/v1/providers/profiles/' + profile, 'PUT',
                    {'name': 'Owned journey', 'provider': 'compatible', 'base_url': f'http://127.0.0.1:{server.server_port}',
                     'model': 'owned-journey', 'version': 0})
            job = request(f'/v1/providers/profiles/{profile}/checks/tools', 'POST', {}, key='owned-fixture')
            for _ in range(150):
                check = request('/v1/providers/profiles/checks/' + job['id'])
                if check['status'] != 'running':
                    break
                time.sleep(.03)
            assert check['status'] == 'completed', check
            ask = {'scope': {'mode': 'topic', 'topic_id': owner}, 'question': 'Discuss a fixture idea and preview notes',
                   'request_id': str(uuid4()), 'profile_id': profile, 'config_version': 1}
            start = request('/v1/research/ask', 'POST', ask, key='owned-fixture')
            first = completed(request, start['session_id'])
            assert {s['document_id'] for s in first['sources']} == {document}
            stale = request('/v1/collaboration/proposals?task_id=' + first['id'])['items'][0]
            assert not request(f'/v1/topics/{owner}/overview')['owned_notes']  # preview only
            memory = request('/v1/research-memory/' + owner)
            request('/v1/research-memory/' + owner, 'PATCH',
                    {'version': memory['content_version'], 'text': correction})
            assert request('/v1/collaboration/proposals/' + stale['id'])['stale']
            with pytest.raises(HTTPError) as conflict:
                request('/v1/collaboration/proposals/' + stale['id'] + '/accept', 'POST',
                        {'request_id': str(uuid4()), 'version': stale['version'], 'selected': ['independent']})
            assert conflict.value.code == 409
            before_restart = len(requests)

        with running(frozen, workspace) as (request, _upload):
            assert len(requests) == before_restart  # restarting/reading never starts a paid request
            assert correction in json.dumps(request('/v1/research-memory/' + owner))
            assert len(request('/v1/research/sessions/' + start['session_id'])['items']) == 1
            continued = request('/v1/research/ask', 'POST',
                                {**ask, 'session_id': start['session_id'], 'request_id': str(uuid4()),
                                 'question': 'Continue the fixture idea; experiment not run; preview notes'}, key='owned-fixture')
            second = completed(request, continued['session_id'])
            assert correction in json.dumps(requests[before_restart:], ensure_ascii=False)
            assert {s['document_id'] for s in second['sources']} == {document}
            proposal = request('/v1/collaboration/proposals?task_id=' + second['id'])['items'][0]
            acceptance = {'request_id': str(uuid4()), 'version': proposal['version'], 'selected': ['independent']}
            accepted = request('/v1/collaboration/proposals/' + proposal['id'] + '/accept', 'POST', acceptance)
            assert request('/v1/collaboration/proposals/' + proposal['id'] + '/accept', 'POST', acceptance)['status'] == 'accepted'
            overview = request(f'/v1/topics/{owner}/overview')
            assert len(overview['owned_notes']) == 1
            assert len(request('/v1/topics')['items']) == 3  # unselected new topic was never created
            formal_id = overview['owned_notes'][0]['id']
            formal = request('/v1/notebooks/' + formal_id)
            assert formal['sources'] and formal['sources'][0]['available']
            assert request('/v1/notebooks/' + note_id)['body_md'] == 'fixture observation, not measured results'
            request(f'/v1/topics/{formal_id}/revisions', 'POST',
                    {'base_revision_id': formal['base_revision_id'], 'body_md': formal['body_md'] + '\nManual follow-up preserved.'})
            with pytest.raises(HTTPError) as conflict:
                request('/v1/collaboration/proposals/' + proposal['id'] + '/undo', 'POST',
                        {'request_id': str(uuid4()), 'version': accepted['version'], 'selected': []})
            assert conflict.value.code == 409
            assert json.load(conflict.value)['error']['code'] == 'UNDO_CONFLICT'
            assert 'Manual follow-up preserved.' in request('/v1/notebooks/' + formal_id)['body_md']
            # Removing the discussion must preserve accepted formal research assets.
            session = request('/v1/research/sessions/' + start['session_id'])['session']
            request('/v1/research/sessions/' + start['session_id'] + '?version=' + str(session['version']), 'DELETE')
            assert 'Manual follow-up preserved.' in request('/v1/notebooks/' + formal_id)['body_md']
            calls_at_end = len(requests)

        with running(frozen, workspace) as (request, _upload):
            assert len(requests) == calls_at_end
            assert 'Manual follow-up preserved.' in request('/v1/notebooks/' + formal_id)['body_md']
            assert request('/v1/collaboration/proposals/' + proposal['id'])['status'] == 'accepted'
    finally:
        server.shutdown()
        server.server_close()

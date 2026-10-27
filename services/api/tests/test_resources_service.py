"""HTTP contracts for stage B metadata, relations, materials and search history."""
import time
import urllib.error
from pathlib import Path
from uuid import uuid4

import pytest

from test_library import pdf_bytes
from test_search_service import running


def upload_document(upload, name):
    return upload(pdf_bytes() + f'\n%{name}\n'.encode())


def wait_task(request, identity):
    for _ in range(200):
        task = request('/v1/ai/tasks/' + identity)
        if task['status'] not in ('queued', 'running'):
            return task
        time.sleep(.02)
    pytest.fail('workflow did not finish')


@pytest.mark.parametrize('frozen', [False, True])
def test_stage_b_http_metadata_relations_materials_and_history(frozen, tmp_path):
    if frozen and not (Path(__file__).resolve().parents[1] / 'dist/yorw-api/yorw-api.exe').exists():
        pytest.skip('Build backend first')
    with running(frozen, tmp_path / 'workspace') as (request, upload):
        assert request('/v1/health')['schema_version'] == 15
        first = upload_document(upload, 'first')
        second = upload_document(upload, 'second')
        preserved = upload_document(upload, 'preserved')
        request('/v1/documents/' + second, 'PATCH', {
            'version': 1, 'title': 'Second paper', 'authors': [], 'year': None})

        updated = request('/v1/documents/' + first, 'PATCH', {
            'version': 1, 'title': 'First paper', 'authors': ['Author'], 'year': 2026,
            'tags': [' RAG ', 'rag', '', '检索增强'], 'summary_md': '  人工总结  '})
        assert updated['tags'] == ['RAG', '检索增强']
        assert updated['summary_md'] == '人工总结' and updated['summary_source'] == 'manual'
        assert updated['summary_updated_at']
        assert request('/v1/documents/' + first)['tags'] == ['RAG', '检索增强']

        tagged_only = request('/v1/documents/' + preserved, 'PATCH', {
            'version': 1, 'tags': ['只整理标签']})
        assert tagged_only['title'] == 'Fixture title'
        assert tagged_only['authors'] == ['Fixture Author']
        assert tagged_only['tags'] == ['只整理标签']
        assert tagged_only['metadata_source']['tags'] == 'user'
        assert tagged_only['metadata_source']['title'] == 'pdf'
        assert tagged_only['metadata_source']['authors'] == 'pdf'

        candidates = request('/v1/documents/' + first + '/related-candidates?query=second')
        assert [item['id'] for item in candidates['items']] == [second]
        relation = request(f'/v1/documents/{first}/relations/{second}', 'PUT', {'description': ' 共同主题 '})
        assert relation['relation']['description'] == '共同主题'
        assert [item['document']['id'] for item in request('/v1/documents/' + second + '/relations')['items']] == [first]
        with pytest.raises(urllib.error.HTTPError) as self_link:
            request(f'/v1/documents/{first}/relations/{first}', 'PUT', {'description': ''})
        assert self_link.value.code == 422
        assert request(f'/v1/documents/{first}/relations/{second}', 'DELETE') == {'removed': True}
        assert request('/v1/documents/' + first + '/relations')['items'] == []

        topic = request('/v1/topics', 'POST', {'id': str(uuid4()), 'title': 'Topic', 'parent_id': None})['topic']
        assert request(f'/v1/documents/{first}/topics/{topic["id"]}', 'PUT') == {'linked': True}
        resource = request('/v1/documents/' + first + '/resource')
        assert resource['document']['summary_md'] == '人工总结'
        assert [item['topic']['id'] for item in resource['topics']] == [topic['id']]
        materials = request('/v1/topics/' + topic['id'] + '/materials')
        assert [item['document']['id'] for item in materials['direct']] == [first]
        assert request(f'/v1/documents/{first}/topics/{topic["id"]}', 'DELETE') == {'linked': False}
        assert request('/v1/topics/' + topic['id'] + '/materials')['direct'] == []

        task = request('/v1/ai/tasks', 'POST', {
            'kind': 'search', 'target_id': first, 'text': 'fixed English evidence', 'request_id': str(uuid4())})
        finished = wait_task(request, task['id'])
        assert finished['status'] == 'succeeded', finished
        history = request('/v1/documents/' + first + '/search-history')['items']
        assert len(history) == 1
        assert history[0]['query'] == 'fixed English evidence' and history[0]['status'] == 'succeeded'
        assert history[0]['items'][0]['available'] is True
        assert request('/v1/documents/' + first + '/search-history/' + history[0]['id'], 'DELETE') == {'deleted': True}
        assert request('/v1/documents/' + first + '/search-history')['items'] == []
        with pytest.raises(urllib.error.HTTPError) as gone:
            request('/v1/documents/' + first + '/search-history/' + history[0]['id'], 'DELETE')
        assert gone.value.code == 404

    with running(frozen, tmp_path / 'workspace') as (request, _):
        reopened = request('/v1/documents/' + first)
        assert reopened['tags'] == ['RAG', '检索增强'] and reopened['summary_md'] == '人工总结'
        assert request('/v1/documents/' + first + '/resource')['topics'] == []

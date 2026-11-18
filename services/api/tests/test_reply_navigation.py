"""Old-conversation structure discovery and verified reply entry regressions."""
import json
from threading import Event
from uuid import uuid4

import pytest

from test_library import library
from test_research import ask, finish, profile
from test_research_catalog import make_folder, make_topic, make_document, link, add_block
from test_research_feedback import step
from yorw_api.research import Research
from yorw_api.research_tools import ResearchTools
from yorw_api.tool_errors import ToolFault
from yorw_api.tool_protocol import ToolTurn


def test_structure_outline_and_garden_paging_are_scope_filtered(library):
    visible, hidden = make_topic(library, '可见研究'), make_topic(library, '隐藏研究')
    folder, secret = make_folder(library, '新生杯'), make_folder(library, '隐藏目录')
    document = make_document(library, '决算单.docx', folder)
    link(library, document, visible)
    make_document(library, '隐藏发票.pdf', secret)
    tools = ResearchTools(library, {'mode': 'topic', 'topic_id': visible})
    outline = tools.execute('inspect_workspace', {})
    assert outline['folders'][0]['path'] == '新生杯' and outline['folders'][0]['document_count'] == 1
    assert outline['topics'][0]['title'] == '可见研究'
    assert outline['folder_count'] == 1 and outline['topic_count'] == 1
    assert hidden not in json.dumps(outline) and secret not in json.dumps(outline)
    for index in range(7):
        make_topic(library, '分页专题' + str(index))
    tools = ResearchTools(library, {'mode': 'workspace'})
    pages = [tools.execute('browse_garden', {'query': '分页专题', 'page_size': 5, 'page': page}) for page in (1, 2)]
    assert pages[0]['has_more'] and not pages[1]['has_more']
    assert sum(len(page['items']) for page in pages) == 7


def test_reply_entries_ignore_forged_ids_and_unmentioned_tool_hits(library):
    owner, hidden = make_topic(library, '本专题'), make_topic(library, '隐藏专题')
    folder = make_folder(library, '材料目录')
    document = make_document(library, '可见材料.pdf', folder)
    link(library, document, owner)
    forged = str(uuid4())
    tools = ResearchTools(library, {'mode': 'topic', 'topic_id': owner})
    entries = tools.catalog.reply_references([{'kind': 'topic', 'id': hidden}, {'kind': 'folder', 'id': forged},
                                             {'kind': 'document', 'id': document}], '材料目录 ' + hidden)
    # The tool result named the document, but the answer did not: only the folder
    # named in the reply becomes a card, and forged/out-of-scope IDs never do.
    assert {entry['id'] for entry in entries} == {folder}
    assert all('navigation' in entry for entry in entries)


def test_reply_entries_follow_the_answer_order_and_not_question_only_names(library):
    first = make_folder(library, '第一个目录')
    second = make_folder(library, '第二个目录')
    tools = ResearchTools(library, {'mode': 'workspace'})
    entries = tools.catalog.reply_references([], '先看第二个目录，再看第一个目录。')
    assert [entry['title'] for entry in entries] == ['第二个目录', '第一个目录']
    assert tools.catalog.reply_references([], '第一个目录') != []


def test_reply_entries_resolve_original_filenames_paths_and_reading_notes(library):
    owner = make_topic(library, '本专题')
    outer = make_folder(library, '活动')
    folder = make_folder(library, '新生杯', outer)
    document = make_document(library, '决算单（2026-2027新生杯）(1).docx', folder)
    link(library, document, owner)
    with library.db.write() as conn:
        note = str(uuid4())
        conn.execute('INSERT INTO notes(id,document_id,body_md,version,created_at,updated_at) VALUES(?,?,?,1,?,?)',
                     (note, document, '决算明细', '2026-11-17T00:00:00Z', '2026-11-17T00:00:00Z'))
    tools = ResearchTools(library, {'mode': 'topic', 'topic_id': owner})
    entries = tools.catalog.reply_references([], '决算单（2026-2027新生杯）(1).docx 位于 活动/新生杯，另有阅读笔记')
    by_kind = {entry['kind']: [] for entry in entries}
    for entry in entries: by_kind[entry['kind']].append(entry)
    assert [entry['id'] for entry in by_kind['document']] == [document]
    assert folder in {entry['id'] for entry in by_kind['folder']}
    assert {entry['path'] for entry in by_kind['folder']} == {'活动', '活动/新生杯'}
    entries = tools.catalog.reply_references([{'kind': 'reading_note', 'id': note}], '可参考《决算单（2026-2027新生杯）(1).docx》阅读笔记。')
    notes = [entry for entry in entries if entry['kind'] == 'reading_note']
    assert notes == [{'kind': 'reading_note', 'id': note, 'title': '《决算单（2026-2027新生杯）(1).docx》阅读笔记',
                      'document_id': document,
                      'navigation': {'module': 'Storage', 'tab': 'notes', 'id': document,
                                     'title': '《决算单（2026-2027新生杯）(1).docx》阅读笔记'}}]
    # Merely holding a handle to the note is not enough; it must be named.
    assert tools.catalog.reply_references([{'kind': 'reading_note', 'id': note}], '') == []


def test_long_directory_task_compacts_old_tool_output_but_keeps_valid_json(library):
    folder = make_folder(library, '大批材料')
    for index in range(8):
        make_document(library, f'材料{index}.pdf', folder)
    pid = profile(library)
    seen = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, **kwargs):
        seen.append(json.loads(json.dumps(messages)))
        results = [message for message in messages if message.get('role') == 'tool']
        if len(results) < 5:
            return step([('page' + str(len(results)), 'browse_library',
                          {'page_size': 5, 'page': len(results) + 1})], validators)
        return {'role': 'assistant', 'content': '目录已列完。'}, [], None

    service = Research(library, turn)
    try:
        start = service.start(ask(pid, '列出目录'), 'fixture')
        task = finish(service, start['session_id'])['items'][-1]
        assert task['status'] == 'completed'
        assert task['usage']['tool_calls'] == 5
        later = [json.loads(message['content']) for message in seen[-1] if message.get('role') == 'tool']
        assert any(item.get('compacted') and item.get('result_type') == 'library' for item in later)
        assert not later[-1].get('compacted')
        assert all(item.get('kind') == 'library' for item in later)
    finally:
        service.close()


def test_old_capability_denial_does_not_remove_current_structure_context(library):
    folder = make_folder(library, '新生杯')
    make_document(library, '决算单.docx', folder)
    pid = profile(library)
    seen = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, **kwargs):
        seen.append(json.loads(json.dumps(messages)))
        if len(seen) == 1:
            return {'role': 'assistant', 'content': '旧版本无法看到 Storage 目录。'}, [], None
        assert {'inspect_workspace', 'browse_garden', 'search_library'} <= {schema['function']['name'] for schema in schemas}
        assert any('当前可见 Storage 与 Garden 结构' in m.get('content', '') and '新生杯' in m['content'] for m in messages)
        if not any(m['role'] == 'tool' for m in messages):
            return step([('folder', 'search_library', {'query': '新生杯', 'kind': 'folder'})], validators)
        return {'role': 'assistant', 'content': '已找到新生杯目录，可以打开详情。'}, [], None

    service = Research(library, turn)
    try:
        start = service.start(ask(pid, '旧问题'), 'fixture')
        finish(service, start['session_id'])
        service.start(ask(pid, 'Storage 有没有新生杯文件夹？', session_id=start['session_id']), 'fixture')
        task = finish(service, start['session_id'])['items'][-1]
        assert task['status'] == 'completed'
        assert any(entry['kind'] == 'folder' and entry['id'] == folder for entry in task['references'])
    finally:
        service.close()


def test_created_proposal_is_linked_from_completed_and_followup_tasks(library):
    pid = profile(library)

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, **kwargs):
        if messages[-1].get('content') == '显示当前方案':
            return {'role': 'assistant', 'content': '请查看下方当前方案。'}, [], None
        if not any(m['role'] == 'tool' for m in messages):
            return step([('proposal', 'propose_changes', {'operations': [
                {'key': 'topic', 'action': 'create_topic', 'title': '新生杯', 'reason': '用户要求'}]})], validators)
        return {'role': 'assistant', 'content': '方案已经准备好，请查看详情。'}, [], None

    service = Research(library, turn)
    try:
        start = service.start(ask(pid, '创建新生杯专题'), 'fixture')
        task = finish(service, start['session_id'])['items'][-1]
        assert task['related_proposal_ids']
        proposal = task['related_proposal_ids'][0]
        service.start(ask(pid, '显示当前方案', session_id=start['session_id']), 'fixture')
        follow = finish(service, start['session_id'])['items'][-1]
        assert proposal in follow['related_proposal_ids']
    finally:
        service.close()


def test_reply_cards_wait_for_the_finished_answer(library):
    folder = make_folder(library, '新生杯')
    make_document(library, '决算单.docx', folder)
    pid = profile(library)
    entered, gate = Event(), Event()

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, **kwargs):
        if not any(message['role'] == 'tool' for message in messages):
            return step([('folder', 'search_library', {'query': '新生杯', 'kind': 'folder'})], validators)
        entered.set(); gate.wait(3)
        return {'role': 'assistant', 'content': '已核对新生杯目录。'}, [], None

    service = Research(library, turn)
    try:
        start = service.start(ask(pid, '查看新生杯'), 'fixture')
        assert entered.wait(3)
        running = service.view(start['session_id'])['items'][-1]
        assert running['status'] == 'running' and running['references'] == []
        gate.set()
        task = finish(service, start['session_id'])['items'][-1]
        assert task['status'] == 'completed'
        assert {(entry['kind'], entry['id']) for entry in task['references']} == {('folder', folder)}
    finally:
        gate.set(); service.close()


def test_repeated_tool_call_replays_the_previous_result_instead_of_stopping(library):
    make_folder(library, '新生杯')
    pid = profile(library)

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, **kwargs):
        results = [message for message in messages if message.get('role') == 'tool']
        if not results:
            return step([('first', 'search_library', {'query': '新生杯', 'kind': 'folder'})], validators)
        if len(results) == 1:
            return step([('again', 'search_library', {'query': '新生杯', 'kind': 'folder'})], validators)
        if len(results) == 2:
            replay = json.loads(results[-1]['content'])
            assert replay['repeat'] is True and replay['summary']['total'] == 1
            return step([('other', 'search_library', {'query': '新生', 'kind': 'folder'})], validators)
        return {'role': 'assistant', 'content': '已换一种方式核对。'}, [], None

    service = Research(library, turn)
    try:
        start = service.start(ask(pid, '核对新生杯'), 'fixture')
        task = finish(service, start['session_id'])['items'][-1]
        assert task['status'] == 'completed'
        assert [call['status'] for call in task['tool_calls']] == ['ok', 'ok', 'ok']
    finally:
        service.close()


def test_third_identical_successful_call_stops_a_loop(library):
    make_folder(library, '新生杯')
    pid = profile(library)
    attempts = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, **kwargs):
        attempts.append(1)
        return step([('same', 'search_library', {'query': '新生杯', 'kind': 'folder'})], validators)

    service = Research(library, turn)
    try:
        start = service.start(ask(pid, '一直重复'), 'fixture')
        task = finish(service, start['session_id'])['items'][-1]
        assert task['status'] == 'failed' and task['error_code'] == 'REPEATED_TOOL_CALL'
        assert len(attempts) == 4
    finally:
        service.close()


def test_read_document_returns_ordered_handles_that_read_local_can_cite(library):
    document = make_document(library, '材料.pdf')
    add_block(library, document, 'fixture evidence')
    empty = make_document(library, '空文档.pdf')
    tools = ResearchTools(library, {'mode': 'workspace'})
    result = tools.execute('read_document', {'id': document})
    assert result['state'] == 'ok' and result['total_blocks'] == 1 and result['next'] is None
    assert result['items'][0]['page'] == 1
    source = tools.execute('read_local', {'handle': result['items'][0]['handle']})
    assert source['citation'] == 'S1' and 'fixture evidence' in source['text']
    assert tools.execute('read_document', {'id': empty})['state'] == 'empty'
    with pytest.raises(ToolFault):
        tools.execute('read_document', {'id': str(uuid4())})


def test_four_document_note_preview_completes_within_the_task_limits(library):
    folder = make_folder(library, '新生杯')
    documents = [make_document(library, f'材料{index}.docx', folder) for index in range(4)]
    for index, document in enumerate(documents):
        add_block(library, document, f'fixture evidence {index}')
    topic = make_topic(library, '新生杯专题')
    pid = profile(library)

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, **kwargs):
        results = [json.loads(message['content']) for message in messages if message.get('role') == 'tool']
        browsed = [item for item in results if item.get('kind') == 'document_text']
        if len(browsed) < 4:
            return step([('browse' + str(len(browsed)), 'read_document', {'id': documents[len(browsed)]})], validators)
        cited = [item for item in results if item.get('citation')]
        if len(cited) < 4:
            handle = browsed[len(cited)]['items'][0]['handle']
            return step([('cite' + str(len(cited)), 'read_local', {'handle': handle})], validators)
        if not any(item.get('proposal_id') for item in results):
            return step([('note', 'propose_changes', {'operations': [{
                'key': 'overview', 'action': 'create_note', 'owner': topic, 'title': '材料概览',
                'body_md': '四篇材料的原文已核对 [S1][S2][S3][S4]。', 'reason': '用户要求根据四篇文献生成笔记'}]})],
            validators)
        return {'role': 'assistant', 'content': '已生成专题笔记预览，等待采纳。'}, [], None

    service = Research(library, turn)
    try:
        start = service.start(ask(pid, '根据四篇文献生成专题笔记'), 'fixture')
        task = finish(service, start['session_id'])['items'][-1]
        assert task['status'] == 'completed'
        assert task['usage']['tool_calls'] == 9
        assert len(task['sources']) == 4
        assert task['related_proposal_ids']
    finally:
        service.close()

def test_broken_json_arguments_are_corrected_in_the_same_task(library):
    document = make_document(library, '材料.pdf')
    add_block(library, document, 'fixture evidence')
    pid = profile(library)

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, **kwargs):
        results = [message for message in messages if message.get('role') == 'tool']
        if not results:
            partial = ToolTurn()
            partial.feed({'tool_calls': [{'index': 0, 'id': 'broken',
                                           'function': {'name': 'read_document', 'arguments': '{"id":'}}]})
            message, calls = partial.finish('tool_calls', validators)
            return message, calls, None
        if len(results) == 1:
            error = json.loads(results[-1]['content'])['error']
            assert error['code'] == 'INVALID_TOOL_ARGUMENTS'
            return step([('fixed', 'read_document', {'id': document})], validators)
        return {'role': 'assistant', 'content': '已读取正文。'}, [], None

    service = Research(library, turn)
    try:
        start = service.start(ask(pid, '读取材料'), 'fixture')
        task = finish(service, start['session_id'])['items'][-1]
        assert task['status'] == 'completed'
        assert [call['status'] for call in task['tool_calls']] == ['error', 'ok']
        assert task['tool_calls'][0]['error']['code'] == 'INVALID_TOOL_ARGUMENTS'
    finally:
        service.close()


def test_repeated_broken_json_is_retried_before_the_task_can_finish(library):
    document = make_document(library, '材料.pdf')
    add_block(library, document, 'fixture evidence')
    pid = profile(library)

    def broken(validators):
        partial = ToolTurn()
        partial.feed({'tool_calls': [{'index': 0, 'id': 'broken',
                                       'function': {'name': 'read_document', 'arguments': '{"id":'}}]})
        return partial.finish('tool_calls', validators)

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, **kwargs):
        results = [message for message in messages if message.get('role') == 'tool']
        if len(results) < 2:
            message, calls = broken(validators)
            return message, calls, None
        if len(results) == 2:
            assert json.loads(results[-1]['content'])['error']['code'] == 'INVALID_TOOL_ARGUMENTS'
            return step([('fixed', 'read_document', {'id': document})], validators)
        return {'role': 'assistant', 'content': '已读取正文。'}, [], None

    service = Research(library, turn)
    try:
        start = service.start(ask(pid, '读取材料'), 'fixture')
        task = finish(service, start['session_id'])['items'][-1]
        assert task['status'] == 'completed'
        assert [call['status'] for call in task['tool_calls']] == ['error', 'error', 'ok']
    finally:
        service.close()


def test_long_discovery_reserves_proposal_and_final_reply(library):
    pid = profile(library)
    rounds = []
    def turn(config, key, messages, schemas, validators, stop, deadline, *args, **kwargs):
        ordinal = len(rounds)
        rounds.append(ordinal)
        if ordinal < 8:
            # Distinct valid paging requests reproduce serial discovery consuming rounds.
            return step([(str(ordinal), 'browse_garden', {'page': ordinal + 1})], validators)
        if ordinal == 8:
            assert [s['function']['name'] for s in schemas] == ['propose_changes']
            assert '停止资料浏览' in messages[0]['content']
            return step([('proposal', 'propose_changes', {'operations': [
                {'key': 'topic', 'action': 'create_topic', 'title': '隔离测试研究', 'reason': '明确创建请求'}]})], validators)
        assert not schemas
        return {'role': 'assistant', 'content': '方案已生成，等待用户采纳。'}, [], None
    service = Research(library, turn)
    try:
        start = service.start(ask(pid, '创建研究专题'), 'fixture')
        task = finish(service, start['session_id'])['items'][-1]
        assert task['status'] == 'completed'
        assert any(c['name'] == 'propose_changes' and c['status'] == 'ok' for c in task['tool_calls'])
    finally:
        service.close()

"""R2 agent loop: correctable feedback, mixed tool results and real proposal state.

Every model here is a local script; no external service or user material is used.
"""
import json
from uuid import uuid4

import pytest

from test_library import library
from test_research import ask, finish, profile
from test_research_catalog import make_document, make_topic, research_origin
from yorw_api.collaboration import Collaboration, Decision, Operation, Preview
from yorw_api.providers import ProbeError
from yorw_api.research import Research
from yorw_api.research_tools import ResearchTools
from yorw_api.tool_protocol import ToolTurn


def tool_turn(entries, validators):
    turn = ToolTurn()
    turn.feed({'tool_calls': [
        {'index': index, 'id': identity, 'type': 'function',
         'function': {'name': name, 'arguments': json.dumps(args)}}
        for index, (identity, name, args) in enumerate(entries)]})
    return turn.finish('tool_calls', validators)


def step(entries, validators):
    message, calls = tool_turn(entries, validators)
    return message, calls, None


def test_correctable_argument_error_is_fed_back_then_corrected(library):
    document = make_document(library, '可见材料.txt')
    pid = profile(library)
    seen = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, on_text=None):
        seen.append(json.loads(json.dumps(messages)))
        if len(seen) == 1:
            return step([('bad', 'inspect_document', {'id': 'not-a-uuid'})], validators)
        if len(seen) == 2:
            return step([('good', 'inspect_document', {'id': document})], validators)
        return {'role': 'assistant', 'content': '已核对当前文献。'}, [], None

    service = Research(library, turn)
    try:
        started = service.start(ask(pid, '查看这份材料'), 'fixture')
        task = finish(service, started['session_id'])['items'][0]
        assert task['status'] == 'completed', task
        records = task['tool_calls']
        assert [record['status'] for record in records] == ['error', 'ok']
        assert records[0]['error']['code'] == 'INVALID_ARGUMENT'
        assert records[0]['error']['field'] == 'id'
        assert records[0]['correctable'] is True
        assert records[1]['summary']['id'] == document
        assert task['usage']['corrections'] == 1
        assert task['usage']['tool_calls'] == 2
        assert library.db.version == 31
        assert library.rows('SELECT count(*) AS n FROM research_tool_calls')[0]['n'] == 2
        feedback = next(message for message in seen[1] if message['role'] == 'tool')
        assert feedback['tool_call_id'] == 'bad' and json.loads(feedback['content'])['correctable'] is True
        event = next(item for item in service.events(started['session_id'], 0)['items'] if item['kind'] == 'tool')
        assert set(event['data']) == {'name', 'call_id', 'status', 'error', 'correctable'}
    finally:
        service.close()


def test_third_correctable_error_stops_the_request(library):
    pid = profile(library)
    attempts = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, on_text=None):
        index = len(attempts)
        attempts.append(index)
        return step([(f'bad-{index}', 'inspect_document', {'id': f'not-a-uuid-{index}'})], validators)

    service = Research(library, turn)
    try:
        started = service.start(ask(pid, '反复使用错误参数'), 'fixture')
        task = finish(service, started['session_id'])['items'][0]
        assert task['status'] == 'failed'
        assert task['error_code'] == 'CORRECTION_LIMIT_EXCEEDED'
        assert len(attempts) == 3
        assert [record['status'] for record in task['tool_calls'][:2]] == ['error', 'error']
        assert task['tool_calls'][-1]['status'] == 'blocked'
    finally:
        service.close()


def test_repeated_broken_arguments_stop_at_the_correction_limit(library):
    pid = profile(library)
    attempts = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, on_text=None):
        attempts.append(1)
        return step([('same', 'inspect_document', {'id': 'not-a-uuid'})], validators)

    service = Research(library, turn)
    try:
        started = service.start(ask(pid, '重复同一个错误'), 'fixture')
        task = finish(service, started['session_id'])['items'][0]
        # Broken arguments are the model's own output error: it may resend the same
        # call, but the third failure hits the correction limit instead of looping.
        assert task['status'] == 'failed' and task['error_code'] == 'CORRECTION_LIMIT_EXCEEDED'
        assert len(attempts) == 3
    finally:
        service.close()


def test_multi_tool_turn_keeps_successful_result_and_failed_call(library):
    pid = profile(library)
    turns = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, on_text=None):
        turns.append(json.loads(json.dumps(messages)))
        if len(turns) == 1:
            return step([('browse', 'browse_library', {}),
                         ('bad', 'inspect_document', {'id': 'not-a-uuid'})], validators)
        assert len([message for message in turns[-1] if message['role'] == 'tool']) == 2
        return {'role': 'assistant', 'content': '目录已读取，另一个参数无效后已修正说明。'}, [], None

    service = Research(library, turn)
    try:
        started = service.start(ask(pid, '同时读取目录和材料'), 'fixture')
        task = finish(service, started['session_id'])['items'][0]
        assert task['status'] == 'completed'
        assert [record['status'] for record in task['tool_calls']] == ['ok', 'error']
        assert [record['call_id'] for record in task['tool_calls']] == ['browse', 'bad']
        tool_messages = [message for message in turns[1] if message['role'] == 'tool']
        assert [message['tool_call_id'] for message in tool_messages] == ['browse', 'bad']
    finally:
        service.close()


def test_typed_operations_create_real_preview_even_when_model_fails_later(library):
    pid = profile(library)
    schemas = []
    turns = []

    def turn(config, key, messages, schemas_in, validators, stop, deadline, max_tokens, on_text=None):
        turns.append(1); schemas.append(schemas_in)
        if len(turns) == 1:
            return step([('plan', 'propose_changes', {'operations': [
                {'key': 'new', 'action': 'create_topic', 'title': '方案专题', 'reason': '用户明确要求'}]})], validators)
        raise ProbeError('NETWORK_ERROR')

    service = Research(library, turn)
    try:
        started = service.start(ask(pid, '整理一个专题'), 'fixture')
        task = finish(service, started['session_id'])['items'][0]
        assert task['status'] == 'failed' and task['error_code'] == 'NETWORK_ERROR'
        assert task['tool_calls'][0]['status'] == 'ok'
        assert task['tool_calls'][0]['summary']['status'] == 'pending'
        proposal = Collaboration(library).list(task_id=started['task_id'])['items'][0]
        assert proposal['operations'][0]['title'] == '方案专题'
        assert proposal['dependencies'] == []
        assert proposal['stale'] is False
        accepted = Collaboration(library).decide(proposal['id'], Decision(request_id=uuid4(),
            version=proposal['version'], selected=['new']), 'accept')
        assert accepted['status'] == 'accepted'
        parameters = next(item['function']['parameters'] for item in schemas[0]
                          if item['function']['name'] == 'propose_changes')
        assert parameters['properties']['operations']['type'] == 'array'
    finally:
        service.close()


def test_legacy_operations_string_remains_accepted(library):
    pid = profile(library)
    turns = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, on_text=None):
        turns.append(1)
        if len(turns) == 1:
            return step([('plan', 'propose_changes', {'operations': json.dumps([
                {'key': 'new', 'action': 'create_topic', 'title': '兼容方案', 'reason': '旧格式兼容'}])})], validators)
        return {'role': 'assistant', 'content': '方案已生成，等待采纳。'}, [], None

    service = Research(library, turn)
    try:
        started = service.start(ask(pid, '用旧格式生成方案'), 'fixture')
        task = finish(service, started['session_id'])['items'][0]
        assert task['status'] == 'completed'
        proposal = Collaboration(library).list(task_id=started['task_id'])['items'][0]
        assert proposal['operations'][0]['title'] == '兼容方案'
    finally:
        service.close()


def test_invalid_operation_is_correctable_then_preview_succeeds(library):
    pid = profile(library); turns = []
    bad = {'key': 'note', 'action': 'create_note', 'owner': '$missing',
           'title': 'Bad dependency', 'body_md': 'Never stored', 'reason': 'bad reference'}
    good = {'key': 'topic', 'action': 'create_topic', 'title': '修正专题', 'reason': '用户明确要求'}

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, on_text=None):
        turns.append(1)
        if len(turns) == 1:
            return step([('plan', 'propose_changes', {'operations': [bad]})], validators)
        if len(turns) == 2:
            return step([('plan2', 'propose_changes', {'operations': [good]})], validators)
        return {'role': 'assistant', 'content': '方案已生成，等待采纳。'}, [], None

    service = Research(library, turn)
    try:
        started = service.start(ask(pid, '修正方案依赖'), 'fixture')
        task = finish(service, started['session_id'])['items'][0]
        assert task['status'] == 'completed'
        assert task['tool_calls'][0]['status'] == 'error'
        assert task['tool_calls'][0]['error']['code'] == 'INVALID_DEPENDENCY'
        assert task['tool_calls'][0]['error']['field'] == 'operations'
        assert task['tool_calls'][1]['status'] == 'ok'
        proposal = Collaboration(library).list(task_id=started['task_id'])['items'][0]
        assert proposal['operations'][0]['title'] == '修正专题'
        assert task['usage']['corrections'] == 1
    finally:
        service.close()


def test_followup_receives_current_proposal_state_and_adoption_receipt(library):
    pid = profile(library); first = Research(library, lambda *a, **k: ({'role': 'assistant', 'content': '先建立会话。'}, [], None))
    try:
        started = first.start(ask(pid, '建立研究会话'), 'fixture')
        finish(first, started['session_id'])
        proposal = Collaboration(library).preview(Preview(request_id=uuid4(), task_id=started['task_id'],
            operations=[Operation(key='new', action='create_topic', title='已采纳专题', reason='用户明确要求')]))
        Collaboration(library).decide(proposal['id'], Decision(request_id=uuid4(),
            version=proposal['version'], selected=['new']), 'accept')
        topic_id = proposal['operations'][0]['object_id']
    finally:
        first.close()
    captured = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, on_text=None):
        captured.append(json.loads(json.dumps(messages)))
        return {'role': 'assistant', 'content': '该专题已经采纳并存在。'}, [], None

    service = Research(library, turn)
    try:
        second = service.start(ask(pid, '为什么还没有创建专题？', session_id=started['session_id']), 'fixture')
        finish(service, started['session_id'])
        context = next(message['content'] for message in captured[0]
                       if message['role'] == 'system' and '当前会话方案状态' in message['content'])
        assert '"status": "accepted"' in context and topic_id in context
        assert 'pending' in context and '非指令' in context
    finally:
        service.close()


def test_visible_output_survives_tool_rounds_and_failure(library):
    pid = profile(library); turns = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, on_text=None):
        turns.append(1)
        if len(turns) == 1:
            on_text('先查看目录。')
            return step([('browse', 'browse_library', {})], validators)
        raise ProbeError('NETWORK_ERROR')

    service = Research(library, turn)
    try:
        started = service.start(ask(pid, '保留已有输出'), 'fixture')
        task = finish(service, started['session_id'])['items'][0]
        assert task['status'] == 'failed' and '先查看目录。' in task['body_md']
    finally:
        service.close()


def test_visible_output_is_appended_to_the_final_answer(library):
    pid = profile(library); turns = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, on_text=None):
        turns.append(1)
        if len(turns) == 1:
            on_text('先查看目录。')
            return step([('browse', 'browse_library', {})], validators)
        on_text('最终回答。')
        return {'role': 'assistant', 'content': '最终回答。'}, [], None

    service = Research(library, turn)
    try:
        started = service.start(ask(pid, '保留两段输出'), 'fixture')
        task = finish(service, started['session_id'])['items'][0]
        assert task['status'] == 'completed'
        assert '先查看目录。' in task['body_md'] and '最终回答。' in task['body_md']
    finally:
        service.close()


def test_terminal_tool_error_stops_without_correction_round(library, monkeypatch):
    pid = profile(library); attempts = []

    def turn(config, key, messages, schemas, validators, stop, deadline, max_tokens, on_text=None):
        attempts.append(1)
        return step([('browse', 'browse_library', {})], validators)

    def terminal(self, name, value):
        raise ProbeError('SOURCE_UNAVAILABLE')

    monkeypatch.setattr(ResearchTools, 'execute', terminal)
    service = Research(library, turn)
    try:
        started = service.start(ask(pid, '来源失效'), 'fixture')
        task = finish(service, started['session_id'])['items'][0]
        assert task['status'] == 'failed' and task['error_code'] == 'SOURCE_UNAVAILABLE'
        assert len(attempts) == 1
    finally:
        service.close()


def test_proposal_state_truncates_without_claiming_no_proposals(library):
    tid,sid=research_origin(library)
    operations=[{'key':f'op{index}','action':'create_topic','title':'长标题'*30,
                 'reason':'用户明确要求'} for index in range(20)]
    item=Collaboration(library).preview(Preview(request_id=uuid4(),task_id=tid,
        operations=[Operation(**operation) for operation in operations]))
    service=Research(library,lambda *a,**k:({'role':'assistant','content':'ok'},[],None))
    try:
        state=service.proposal_state(sid);data=json.loads(state)
        assert data['proposals'] and data['proposals'][0]['proposal_id']==item['id']
        assert len(state.encode())<=3000
    finally:service.close()


def test_long_prior_output_keeps_the_final_answer(library):
    pid=profile(library);turns=[]

    def turn(config,key,messages,schemas,validators,stop,deadline,max_tokens,on_text=None):
        turns.append(1)
        if len(turns)==1:
            on_text('A'*31990)
            return step([('browse','browse_library',{})],validators)
        return {'role':'assistant','content':'FINAL-ANSWER-END'},[],None

    service=Research(library,turn)
    try:
        started=service.start(ask(pid,'长过程后给出结论'),'fixture')
        task=finish(service,started['session_id'])['items'][0]
        assert task['status']=='completed'
        assert task['body_md'].endswith('FINAL-ANSWER-END') and len(task['body_md'])==32000
    finally:service.close()


def test_failed_partial_output_is_not_injected_into_next_task(library):
    pid=profile(library)

    def first(config,key,messages,schemas,validators,stop,deadline,max_tokens,on_text=None):
        on_text('PARTIAL-CONCLUSION')
        raise ProbeError('NETWORK_ERROR')

    service=Research(library,first)
    try:
        started=service.start(ask(pid,'第一问'),'fixture')
        assert finish(service,started['session_id'])['items'][0]['status']=='failed'
    finally:service.close()
    captured=[]

    def second(config,key,messages,schemas,validators,stop,deadline,max_tokens,on_text=None):
        captured.append(json.loads(json.dumps(messages)))
        return {'role':'assistant','content':'第二问回答'},[],None

    service=Research(library,second)
    try:
        service.start(ask(pid,'第二问',session_id=started['session_id']),'fixture')
        finish(service,started['session_id'])
        assert all('PARTIAL-CONCLUSION' not in (message.get('content') or '') for message in captured[0])
    finally:service.close()


def test_adoption_receipt_includes_relation_records(library):
    document=make_document(library,'材料.txt');pid=profile(library)
    service=Research(library,lambda *a,**k:({'role':'assistant','content':'建立会话'},[],None))
    try:
        started=service.start(ask(pid,'建立研究会话'),'fixture');finish(service,started['session_id'])
        proposal=Collaboration(library).preview(Preview(request_id=uuid4(),task_id=started['task_id'],operations=[
            Operation(key='topic',action='create_topic',title='正式专题',reason='用户明确要求'),
            Operation(key='link',action='link',first_kind='document',first=document,
                      second_kind='topic',second='$topic',reason='用户明确要求')]))
        accepted=Collaboration(library).decide(proposal['id'],Decision(request_id=uuid4(),
            version=proposal['version'],selected=['topic','link']),'accept')
        assert accepted['status']=='accepted'
        state=json.loads(service.proposal_state(started['session_id']))
        records=state['proposals'][0]['records']
        assert any(record['kind']=='relation' and record.get('first')==document for record in records)
        assert any(record['kind']=='topic' and record.get('created') for record in records)
    finally:service.close()


def test_mixed_success_and_terminal_error_keeps_success(library,monkeypatch):
    pid=profile(library);attempts=[];original=ResearchTools.execute
    def execute(self,name,value):
        if name=='inspect_document':raise ProbeError('SOURCE_UNAVAILABLE')
        return original(self,name,value)
    monkeypatch.setattr(ResearchTools,'execute',execute)

    def turn(config,key,messages,schemas,validators,stop,deadline,max_tokens,on_text=None):
        attempts.append(1)
        return step([('browse','browse_library',{}),
                     ('bad','inspect_document',{'id':str(uuid4())})],validators)

    service=Research(library,turn)
    try:
        started=service.start(ask(pid,'混合成功与终止'),'fixture')
        task=finish(service,started['session_id'])['items'][0]
        assert task['status']=='failed' and task['error_code']=='SOURCE_UNAVAILABLE'
        assert len(attempts)==1
        assert [record['status'] for record in task['tool_calls']]==['ok','error']
    finally:service.close()

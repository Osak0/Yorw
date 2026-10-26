"""Exercise real SSE parsing and request budgets without external API calls."""
from io import BytesIO
import json
from unittest.mock import patch

import pytest

from yorw_api.chat import stream, StreamState, CHAT_OUTPUT_TOKENS, DRAFT_OUTPUT_TOKENS
from yorw_api.providers import ProbeError


def consume(events, *, done=True, **options):
    payloads = []
    data = ''.join('data: ' + json.dumps(event) + '\n\n' for event in events)
    if done:
        data += 'data: [DONE]\n\n'

    class Opener:
        def open(self, request, timeout):
            payloads.append(json.loads(request.data))
            return BytesIO(data.encode())

    def response():
        with patch('urllib.request.build_opener', return_value=Opener()):
            yield from stream({'model': 'fixture', 'base_url': 'https://example.invalid'},
                              'test-secret', 'question', [{'text': 'Evidence', 'physical_page': 2}], **options)

    return response(), payloads


def event(text='', finish=None):
    return {'choices': [{'delta': {'content': text}, 'finish_reason': finish}]}


@pytest.mark.parametrize(('finish', 'code'), [
    ('length', 'OUTPUT_TRUNCATED'),
    ('content_filter', 'CONTENT_FILTERED'),
    ('insufficient_system_resource', 'UPSTREAM_RESOURCE_UNAVAILABLE'),
    ('aborted', 'UPSTREAM_ABORTED'),
    ('tool_calls', 'UNSUPPORTED_TOOL_CALL'),
    ('unrecognized-provider-value', 'INVALID_RESPONSE'),
])
def test_finish_reason_keeps_partial_text_and_distinguishes_errors(finish, code):
    state = StreamState()
    output, payloads = consume([event('Partial [S1]'), event(finish=finish)], state=state)
    assert next(output) == 'Partial [S1]'
    # Empty content in a finish event is legal and must not swallow its reason.
    assert next(output) == ''
    with pytest.raises(ProbeError) as caught:
        next(output)
    assert caught.value.code == code
    assert state.finish_reason == ('unknown' if finish.startswith('unrecognized') else finish)
    assert payloads[0]['max_tokens'] == CHAT_OUTPUT_TOKENS == 4096
    assert 'test-secret' not in json.dumps(payloads)


def test_draft_continuation_retains_evidence_and_has_a_separate_budget():
    partial = '# Draft\n\nEarlier evidence [S1]. Incomplete'
    output, payloads = consume([event(' sentence [S1].', 'stop')],
                               max_tokens=DRAFT_OUTPUT_TOKENS, continuation=partial)
    assert ''.join(output) == ' sentence [S1].'
    request = payloads[0]
    assert request['max_tokens'] == 8192
    assert [m['role'] for m in request['messages']] == ['system', 'user', 'assistant', 'user']
    assert request['messages'][2]['content'] == partial
    assert json.loads(request['messages'][1]['content'])['evidence'] == [
        {'id': 'S1', 'physical_page': 2, 'text': 'Evidence'}]


@pytest.mark.parametrize('finish', [None, 'stop'])
def test_eof_is_not_a_completed_stream_even_after_stop(finish):
    output, _ = consume([event('Partial [S1]', finish)], done=False)
    assert next(output) == 'Partial [S1]'
    with pytest.raises(ProbeError) as caught:
        next(output)
    assert caught.value.code == 'STREAM_INTERRUPTED'


@pytest.mark.parametrize('invalid', [[], {'choices': 'wrong'}, {'choices': [None]},
                                    {'choices': [{'delta': None}]},
                                    {'choices': [{'delta': {'content': 2}}]}])
def test_malformed_stream_is_a_safe_protocol_error(invalid):
    output, _ = consume([invalid])
    with pytest.raises(ProbeError) as caught:
        list(output)
    assert caught.value.code == 'INVALID_RESPONSE'

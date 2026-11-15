import pytest
from yorw_api.tool_protocol import ToolTurn
from yorw_api.providers import ProbeError


def test_fragmented_arguments_and_reasoning_roundtrip():
    turn = ToolTurn()
    turn.feed({"reasoning_content": "plan", "tool_calls": [{"index": 0, "id": "call1", "function": {"name": "read", "arguments": '{"id":'}}]})
    turn.feed({"tool_calls": [{"index": 0, "function": {"arguments": '"one"}'}}]})
    message, calls = turn.finish("tool_calls", {"read": lambda x: x})
    assert message["reasoning_content"] == "plan"
    assert calls == [("call1", "read", {"id": "one"})]
    assert message["tool_calls"][0]["function"]["arguments"] == '{"id":"one"}'


@pytest.mark.parametrize("reason,args,name", [("length", "{}", "read"), ("tool_calls", "{", "read"), ("tool_calls", "[]", "read"), ("tool_calls", "{}", "unknown")])
def test_invalid_turn_never_reaches_execution(reason, args, name):
    turn = ToolTurn()
    turn.feed({"tool_calls": [{"index": 0, "id": "a", "function": {"name": name, "arguments": args}}]})
    with pytest.raises(ProbeError):
        turn.finish(reason, {"read": lambda x: x})


def test_budget_and_completed_turn():
    with pytest.raises(ProbeError):
        ToolTurn(max_bytes=2).feed({"content": "large"})
    turn = ToolTurn()
    turn.feed({"content": "OK"})
    assert turn.finish("stop", {}) == ({"role": "assistant", "content": "OK"}, [])
    with pytest.raises(ProbeError):
        turn.feed({"content": "again"})


@pytest.mark.parametrize('delta',[{'tool_calls':{'bad':True}},{'tool_calls':[None]},{'tool_calls':[{'index':True}]},{'tool_calls':[{'index':0,'function':'bad'}]}])
def test_malformed_stream_fields_are_safe_errors(delta):
    with pytest.raises(ProbeError):
        ToolTurn().feed(delta)

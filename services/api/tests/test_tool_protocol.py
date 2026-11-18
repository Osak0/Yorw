import pytest
from yorw_api.tool_protocol import ToolTurn
from yorw_api.tool_errors import ToolFault
from yorw_api.providers import ProbeError


def test_fragmented_arguments_and_reasoning_roundtrip():
    turn = ToolTurn()
    turn.feed({"reasoning_content": "plan", "tool_calls": [{"index": 0, "id": "call1", "function": {"name": "read", "arguments": '{"id":'}}]})
    turn.feed({"tool_calls": [{"index": 0, "function": {"arguments": '"one"}'}}]})
    message, calls = turn.finish("tool_calls", {"read": lambda x: x})
    assert message["reasoning_content"] == "plan"
    assert [(call.id, call.name, call.value) for call in calls] == [("call1", "read", {"id": "one"})]
    assert message["tool_calls"][0]["function"]["arguments"] == '{"id":"one"}'


@pytest.mark.parametrize("reason,args,name", [("length", "{}", "read"), ("tool_calls", "{}", "unknown")])
def test_invalid_turn_never_reaches_execution(reason, args, name):
    turn = ToolTurn()
    turn.feed({"tool_calls": [{"index": 0, "id": "a", "function": {"name": name, "arguments": args}}]})
    with pytest.raises(ProbeError):
        turn.finish(reason, {"read": lambda x: x})


def test_broken_arguments_become_a_correctable_fault_instead_of_stopping():
    turn = ToolTurn()
    turn.feed({"tool_calls": [{"index": 0, "id": "a", "function": {"name": "read", "arguments": "{not json"}}]})
    message, calls = turn.finish("tool_calls", {"read": lambda x: x})
    assert calls[0].fault.code == "INVALID_TOOL_ARGUMENTS" and calls[0].fault.correctable
    assert calls[0].value is None and calls[0].arguments == "{not json"


def test_complete_but_non_object_arguments_are_correctable():
    turn = ToolTurn()
    turn.feed({"tool_calls": [{"index": 0, "id": "a", "function": {"name": "read", "arguments": '[]'}}]})
    message, calls = turn.finish("tool_calls", {"read": lambda value: value})
    assert calls[0].fault.code == "INVALID_ARGUMENT"
    assert calls[0].fault.field == "arguments" and calls[0].fault.correctable


def test_budget_and_completed_turn():
    with pytest.raises(ProbeError):
        ToolTurn(max_bytes=2).feed({"content": "large"})
    turn = ToolTurn()
    turn.feed({"content": "OK"})
    assert turn.finish("stop", {}) == ({"role": "assistant", "content": "OK"}, [])
    with pytest.raises(ProbeError):
        turn.feed({"content": "again"})


def test_correctable_business_fault_keeps_call_and_tool_id():
    turn = ToolTurn()
    turn.feed({"tool_calls": [
        {"index": 0, "id": "good", "function": {"name": "read", "arguments": '{"id":"one"}'}},
        {"index": 1, "id": "bad", "function": {"name": "read", "arguments": '{"id":"missing"}'}},
    ]})
    def validate(value):
        if value["id"] == "missing":
            raise ToolFault("OBJECT_NOT_FOUND", field="id", expected="a visible document UUID")
        return value
    message, calls = turn.finish("tool_calls", {"read": validate})
    assert [call.id for call in calls] == ["good", "bad"]
    assert calls[0].value == {"id": "one"} and calls[0].fault is None
    assert calls[1].value is None
    assert calls[1].fault.code == "OBJECT_NOT_FOUND"
    assert calls[1].fault.field == "id" and calls[1].fault.correctable is True
    assert [item["id"] for item in message["tool_calls"]] == ["good", "bad"]


def test_legacy_value_error_is_a_correctable_fault():
    turn = ToolTurn()
    turn.feed({"tool_calls": [{"index": 0, "id": "a", "function": {"name": "read", "arguments": '{"id":"bad"}'}}]})
    message, calls = turn.finish("tool_calls", {"read": lambda value: (_ for _ in ()).throw(ValueError())})
    assert calls[0].fault.correctable is True
    assert calls[0].fault.code == "INVALID_ARGUMENT"


def test_terminal_business_fault_stops_the_turn():
    turn = ToolTurn()
    turn.feed({"tool_calls": [{"index": 0, "id": "a", "function": {"name": "read", "arguments": '{"id":"one"}'}}]})
    with pytest.raises(ProbeError, match="SOURCE_UNAVAILABLE"):
        turn.finish("tool_calls", {"read": lambda value: (_ for _ in ()).throw(
            ToolFault("SOURCE_UNAVAILABLE", correctable=False))})


@pytest.mark.parametrize('delta',[{'tool_calls':{'bad':True}},{'tool_calls':[None]},{'tool_calls':[{'index':True}]},{'tool_calls':[{'index':0,'function':'bad'}]}])
def test_malformed_stream_fields_are_safe_errors(delta):
    with pytest.raises(ProbeError):
        ToolTurn().feed(delta)

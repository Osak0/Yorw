"""Bounded assembly of OpenAI-compatible streamed tool requests.

No tool executes until its complete arguments have been parsed and validated.
Provider-specific assistant fields are retained for the next model turn.
"""
import copy
import json
from .providers import ProbeError


class ToolTurn:
    def __init__(self, max_calls=16, max_bytes=65536):
        self.max_calls = max_calls
        self.max_bytes = max_bytes
        self.message = {"role": "assistant", "content": ""}
        self.calls = {}
        self.size = 0
        self.finished = False

    def feed(self, delta):
        if self.finished or not isinstance(delta, dict):
            raise ProbeError("INVALID_TOOL_STREAM")
        self.size += len(json.dumps(delta, ensure_ascii=False).encode())
        if self.size > self.max_bytes:
            raise ProbeError("RESPONSE_TOO_LARGE")
        for key, value in delta.items():
            if key in ("role", "tool_calls") or value is None:
                continue
            if isinstance(value, str):
                self.message[key] = self.message.get(key, "") + value
            else:
                self.message[key] = copy.deepcopy(value)
        parts = delta.get("tool_calls") or []
        if not isinstance(parts, list):
            raise ProbeError("INVALID_TOOL_STREAM")
        for part in parts:
            if not isinstance(part, dict):
                raise ProbeError("INVALID_TOOL_STREAM")
            index = part.get("index")
            if type(index) is not int or not 0 <= index < self.max_calls:
                raise ProbeError("INVALID_TOOL_STREAM")
            call = self.calls.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
            if part.get("type", "function") != "function":
                raise ProbeError("UNSUPPORTED_TOOL_CALL")
            for field in ("id",):
                value = part.get(field)
                if value is not None:
                    if not isinstance(value, str):
                        raise ProbeError("INVALID_TOOL_STREAM")
                    call[field] += value
            function = part.get("function") or {}
            if not isinstance(function, dict):
                raise ProbeError("INVALID_TOOL_STREAM")
            for field in ("name", "arguments"):
                value = function.get(field)
                if value is not None:
                    if not isinstance(value, str):
                        raise ProbeError("INVALID_TOOL_STREAM")
                    call["function"][field] += value

    def finish(self, reason, validators):
        if self.finished:
            raise ProbeError("INVALID_TOOL_STREAM")
        self.finished = True
        if reason != ("tool_calls" if self.calls else "stop"):
            raise ProbeError("STREAM_INTERRUPTED")
        calls = [self.calls[i] for i in sorted(self.calls)]
        ids = set()
        parsed = []
        for call in calls:
            name = call["function"]["name"]
            if not call["id"] or call["id"] in ids or name not in validators:
                raise ProbeError("INVALID_TOOL_CALL")
            ids.add(call["id"])
            try:
                arguments = json.loads(call["function"]["arguments"])
                if not isinstance(arguments, dict):
                    raise ValueError()
                value = validators[name](arguments)
            except (ValueError, TypeError, KeyError):
                raise ProbeError("INVALID_TOOL_ARGUMENTS") from None
            parsed.append((call["id"], name, value))
        if calls:
            self.message["tool_calls"] = calls
        return copy.deepcopy(self.message), parsed

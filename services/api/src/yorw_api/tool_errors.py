"""Correctable tool-input faults, distinct from protocol corruption.

A fault carries a safe code, field and expected format. The agent loop may return it
to the model as the tool result for that call; protocol damage stops the turn.
"""


class ToolFault(Exception):
    def __init__(self, code, *, field=None, expected=None, message=None, correctable=True):
        super().__init__(code)
        self.code = code
        self.field = field
        self.expected = expected
        self.message = message
        self.correctable = correctable

    def error(self):
        result = {'code': self.code}
        for key in ('field', 'expected', 'message'):
            value = getattr(self, key)
            if value: result[key] = value
        return result

    def result(self, tool):
        return {'ok': False, 'tool': tool, 'error': self.error(),
                'correctable': self.correctable, 'result_type': 'tool_error'}

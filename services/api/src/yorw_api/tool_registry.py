"""Single-source declaration of model tools.

A tool's name, description, JSON schema, validator, executor and result kind live in
one spec, so the declaration sent to a model cannot drift from what actually runs.
"""
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    parameters: dict
    result_kind: str
    validate: Callable[[dict], dict]
    execute: Callable[[dict], dict]

    def schema(self):
        return {'type': 'function', 'function': {
            'name': self.name, 'description': self.description,
            'parameters': self.parameters}}


class ToolRegistry:
    def __init__(self):
        self.specs = {}

    def register(self, spec):
        if spec.name in self.specs:
            raise ValueError('DUPLICATE_TOOL')
        self.specs[spec.name] = spec
        return spec

    def get(self, name):
        if name not in self.specs:
            raise KeyError(name)
        return self.specs[name]

    def __contains__(self, name):
        return name in self.specs

    @property
    def names(self):
        return list(self.specs)

    def schemas(self):
        return [spec.schema() for spec in self.specs.values()]

    def validate(self, name, value):
        return self.get(name).validate(value)

    def execute(self, name, value):
        spec = self.get(name)
        result = spec.execute(value)
        if isinstance(result, dict):
            result['result_type'] = spec.result_kind
        return result

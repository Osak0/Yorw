"""Bounded OpenAI-compatible embeddings. No keys, inputs or upstream bodies in logs."""
import json
import socket
import urllib.error
import urllib.request
from urllib.parse import urlsplit

import numpy as np

from .providers import NoRedirect, ProbeError

MAX_DIMENSION = 4096


def normalize(values, dimension=None) -> np.ndarray:
    if not isinstance(values, list) or not values or len(values) > MAX_DIMENSION:
        raise ProbeError('INVALID_RESPONSE')
    if dimension is not None and len(values) != dimension:
        raise ProbeError('DIMENSION_CHANGED')
    if not all(type(item) in (int, float) for item in values):
        raise ProbeError('INVALID_RESPONSE')
    try:
        vector = np.asarray(values, dtype=np.float64)
        length = np.linalg.norm(vector)
        if not np.isfinite(vector).all() or not np.isfinite(length) or length <= 0:
            raise ProbeError('INVALID_RESPONSE')
        return (vector / length).astype('<f4')
    except (ValueError, OverflowError):
        raise ProbeError('INVALID_RESPONSE') from None


def embed(config: dict, key: str, texts: list[str], dimension=None, timeout=15) -> list[np.ndarray]:
    if not key:
        raise ProbeError('KEY_MISSING')
    payload = {'model': config['model'], 'input': texts}
    if urlsplit(config['base_url']).hostname != 'open.bigmodel.cn':
        payload['encoding_format'] = 'float'
    request = urllib.request.Request(config['base_url'] + '/embeddings',
        data=json.dumps(payload).encode(),
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout) as response:
            raw = response.read(16_000_001)
        if len(raw) > 16_000_000:
            raise ProbeError('RESPONSE_TOO_LARGE')
        data = json.loads(raw)['data']
        if not isinstance(data, list) or len(data) != len(texts):
            raise ProbeError('INVALID_RESPONSE')
        by_index = {}
        for entry in data:
            index = entry['index']
            if type(index) is not int or index < 0 or index >= len(texts) or index in by_index:
                raise ProbeError('INVALID_RESPONSE')
            vector = normalize(entry['embedding'], dimension)
            if dimension is None:
                dimension = len(vector)
            by_index[index] = vector
        return [by_index[index] for index in range(len(texts))]
    except urllib.error.HTTPError as error:
        raise ProbeError({401: 'AUTH_FAILED', 403: 'AUTH_FAILED', 402: 'INSUFFICIENT_BALANCE', 404: 'MODEL_OR_ENDPOINT_NOT_FOUND', 429: 'RATE_LIMITED'}.get(error.code, 'UPSTREAM_HTTP_ERROR')) from None
    except (TimeoutError, socket.timeout):
        raise ProbeError('TIMEOUT') from None
    except urllib.error.URLError as error:
        raise ProbeError('TIMEOUT' if isinstance(error.reason, TimeoutError) else 'NETWORK_ERROR') from None
    except (ValueError, KeyError, IndexError, TypeError):
        raise ProbeError('INVALID_RESPONSE') from None

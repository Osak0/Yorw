"""Annotate availability without rewriting immutable citation snapshots.

Evidence may reference a versioned content block (new formats) or a legacy PDF
chunk. Both are resolved against the active extraction version. A failed
reparse keeps the active version, so old evidence stays usable until a
successful switch.
"""
from copy import deepcopy
from hashlib import sha256
import json


def resolve_evidence(database, ref):
    """Return normalized evidence, or None when it is stale or invalid."""
    if not isinstance(ref, dict):
        return None
    document_id = ref.get('document_id')
    version = ref.get('extraction_version')
    quote = ref.get('quote', ref.get('text', ''))
    if not isinstance(document_id, str) or not document_id:
        return None
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        return None
    if not isinstance(quote, str) or not quote:
        return None
    connection = database.connection
    block_id = ref.get('block_id')
    if block_id:
        if not isinstance(block_id, str):
            return None
        row = connection.execute(
            'SELECT b.text,b.extraction_version,b.physical_page,b.block_type,b.section_path_json,'
            'd.deleted_at,d.title,d.original_name,d.extraction_version,d.extraction_status '
            'FROM document_blocks b JOIN documents d ON d.id=b.document_id '
            'WHERE b.id=? AND b.document_id=?', (block_id, document_id)).fetchone()
        if not row:
            return None
        text, block_version, page, block_type, section_path_json, deleted_at, title, original_name, live_version, live_status = row
        if deleted_at is not None or live_status not in ('ready', 'partial'):
            return None
        if not (block_version == live_version == version):
            return None
        requested_page = ref.get('physical_page')
        if requested_page is not None and requested_page != page:
            return None
        if quote not in text:
            return None
        try:
            section_path = json.loads(section_path_json)
        except (TypeError, ValueError):
            section_path = []
        if not isinstance(section_path, list):
            section_path = []
        return {
            'document_id': document_id, 'document_title': title or original_name,
            'block_id': block_id, 'chunk_id': ref.get('chunk_id'), 'block_type': block_type,
            'section_path': section_path, 'physical_page': page, 'quote': quote,
            'extraction_version': version,
        }
    chunk_id = ref.get('chunk_id')
    if not chunk_id or not isinstance(chunk_id, str):
        return None
    row = connection.execute(
        'SELECT c.text,c.extraction_version,c.physical_page,d.deleted_at,d.title,d.original_name,'
        'd.extraction_version,d.extraction_status '
        'FROM chunks c JOIN documents d ON d.id=c.document_id '
        'WHERE c.id=? AND c.document_id=?', (chunk_id, document_id)).fetchone()
    if not row:
        return None
    text, chunk_version, page, deleted_at, title, original_name, live_version, live_status = row
    if deleted_at is not None or live_status not in ('ready', 'partial'):
        return None
    if not (chunk_version == live_version == version):
        return None
    requested_page = ref.get('physical_page')
    if requested_page is not None and requested_page != page:
        return None
    if quote not in text:
        return None
    block = connection.execute(
        'SELECT block_type,section_path_json,physical_page FROM document_blocks '
        'WHERE id=? AND document_id=? AND extraction_version=?', (chunk_id, document_id, version)).fetchone()
    if block is not None and block[2] is not None and block[2] != page:
        block = None
    if block is not None:
        try:
            section_path = json.loads(block[1])
        except (TypeError, ValueError):
            section_path = []
        if not isinstance(section_path, list):
            section_path = []
        return {
            'document_id': document_id, 'document_title': title or original_name,
            'block_id': chunk_id, 'chunk_id': chunk_id, 'block_type': block[0],
            'section_path': section_path, 'physical_page': page, 'quote': quote,
            'extraction_version': version,
        }
    return {
        'document_id': document_id, 'document_title': title or original_name,
        'block_id': None, 'chunk_id': chunk_id, 'block_type': None, 'section_path': [],
        'physical_page': page, 'quote': quote, 'extraction_version': version,
    }


def evidence_available(database, ref):
    return resolve_evidence(database, ref) is not None


def source_status(database, sources):
    result = deepcopy(sources)
    conn = database.connection
    for source in result:
        if not isinstance(source, dict):
            continue
        evidence = source.get('evidence', [])
        if 'chunk_id' in source or 'block_id' in source:
            evidence = [source]
        valid = True
        kind, identity, version = source.get('kind'), source.get('source_object_id'), source.get('source_version')
        if kind not in ('document', 'note', 'message', 'wiki') and 'chunk_id' not in source and 'block_id' not in source:
            continue
        if kind == 'document':
            row = conn.execute('SELECT extraction_version,deleted_at,extraction_status FROM documents WHERE id=?', (identity,)).fetchone()
            valid = bool(row and row[1] is None and str(row[0]) == version and row[2] in ('ready', 'partial'))
        elif kind == 'note':
            row = conn.execute('SELECT n.version,d.deleted_at FROM notes n JOIN documents d ON d.id=n.document_id WHERE n.id=?', (identity,)).fetchone()
            valid = bool(row and row[1] is None and str(row[0]) == version)
        elif kind == 'message':
            row = conn.execute('SELECT m.body_md,m.sources_json,m.status,d.deleted_at FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN documents d ON d.id=c.document_id WHERE m.id=?', (identity,)).fetchone()
            valid = bool(row and row[2] == 'completed' and row[3] is None and sha256((row[0]+'\n'+row[1]).encode()).hexdigest() == version)
        elif kind == 'wiki':
            row = conn.execute('SELECT current_revision_id FROM topics WHERE id=?', (identity,)).fetchone()
            valid = bool(row and row[0] == version)
        for ref in evidence:
            if not isinstance(ref, dict):
                valid = False
                continue
            ref['available'] = evidence_available(database, ref)
            valid = valid and ref['available']
        source['available'] = bool(valid)
    return result

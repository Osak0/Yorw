"""Annotate availability without rewriting immutable citation snapshots."""
from copy import deepcopy
from hashlib import sha256


def source_status(database, sources):
    result = deepcopy(sources)
    conn = database.connection
    for source in result:
        if not isinstance(source, dict):
            continue
        evidence = source.get('evidence', [])
        if 'chunk_id' in source:
            evidence = [source]
        valid = True
        kind, identity, version = source.get('kind'), source.get('source_object_id'), source.get('source_version')
        if kind not in ('document','note','message','wiki') and 'chunk_id' not in source:
            continue
        if kind == 'document':
            row = conn.execute('SELECT extraction_version,deleted_at,extraction_status FROM documents WHERE id=?', (identity,)).fetchone()
            valid = bool(row and row[1] is None and str(row[0]) == version and row[2] in ('ready','partial'))
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
            row = conn.execute('SELECT c.text,c.extraction_version,c.physical_page,d.deleted_at,d.extraction_version,d.extraction_status FROM chunks c JOIN documents d ON d.id=c.document_id WHERE c.id=? AND c.document_id=?', (ref.get('chunk_id'), ref.get('document_id'))).fetchone()
            quote = ref.get('quote', ref.get('text', ''))
            ref['available'] = bool(row and row[3] is None and row[5] in ('ready','partial') and row[1] == row[4] == ref.get('extraction_version') and row[2] == ref.get('physical_page') and quote and quote in row[0])
            valid = valid and ref['available']
        source['available'] = bool(valid)
    return result

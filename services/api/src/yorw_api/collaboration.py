"""Explicit, source-bound formal changes; atomic selection, idempotency and guarded undo.

Specs never contain executable SQL or paths. Snapshots are internal and are rebuilt
on repair; neither the renderer nor the model can supply trusted versions.
"""
import difflib
import json
import re
from typing import Literal
from uuid import UUID, uuid4
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from .garden import Garden
from .library import now
from .providers import ProbeError
from .relations import Relations
from .research_tools import ResearchTools, digest


class FolderDependency(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['folder_members'] = 'folder_members'
    folder_id: UUID


class Operation(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    key: str = Field(pattern=r'^[a-zA-Z][a-zA-Z0-9_]{0,39}$')
    action: Literal['create_topic', 'create_note', 'append_note', 'rewrite_note', 'link', 'unlink']
    title: str = Field(default='', max_length=120)
    body_md: str = Field(default='', max_length=50000)
    owner: str = Field(default='', max_length=80)
    target: str = Field(default='', max_length=80)
    first_kind: Literal['document', 'topic'] = 'document'
    first: str = Field(default='', max_length=80)
    second_kind: Literal['document', 'topic'] = 'topic'
    second: str = Field(default='', max_length=80)
    reason: str = Field(min_length=1, max_length=500)
    recommended: bool = False
    first_version: int | None = Field(default=None,ge=1,strict=True)
    second_version: int | None = Field(default=None,ge=1,strict=True)
    target_version: int | None = Field(default=None,ge=1,strict=True)


class Preview(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    task_id: UUID | None = None
    document_id: UUID | None = None
    topic_id: UUID | None = None
    enrichment_id: int | None = Field(default=None,ge=1)
    operations: list[Operation] = Field(min_length=1, max_length=20)
    dependencies: list[FolderDependency] = Field(default_factory=list, max_length=20)


class Decision(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    version: int = Field(ge=1, strict=True)
    selected: list[str] = Field(default_factory=list, max_length=20)


class Collaboration:
    def __init__(self, library):
        self.library, self.db = library, library.db
        self.relations = Relations(library)

    def rows(self, sql, args=()): return self.library.rows(sql, args)

    def entity(self, kind, identity):
        if kind in ('topic', 'document'): return self.relations.entity(kind, identity)
        # Formal topic notes are immutable revision heads, reading notes retain notes IDs.
        rows = self.rows('SELECT n.id,n.topic_id,n.title,n.deleted_at,t.version,t.current_revision_id,t.deleted_at AS head_deleted,r.body_md,r.sources_json FROM topic_notebooks n JOIN topics t ON t.id=n.id JOIN revisions r ON r.id=t.current_revision_id JOIN topics owner ON owner.id=n.topic_id WHERE n.id=? AND n.deleted_at IS NULL AND t.deleted_at IS NULL AND owner.deleted_at IS NULL', (identity,))
        if rows: return {'kind': 'topic_note', **rows[0]}
        rows = self.rows('SELECT n.* FROM notes n JOIN documents d ON d.id=n.document_id WHERE n.id=? AND d.deleted_at IS NULL', (identity,))
        if rows: return {'kind': 'reading_note', **rows[0]}
        raise HTTPException(409, detail='MATERIAL_CHANGED')

    def guard(self, kind, identity):
        return {'kind': kind, 'id': identity, 'hash': digest(self.entity(kind, identity))}

    def context(self, origin):
        def memory_versions(keys):
            return {k:(self.rows('SELECT content_version FROM research_memory_state WHERE scope_key=?',(k,)) or [{'content_version':1}])[0]['content_version'] for k in keys}
        if origin.get('task_id'):
            tid = origin['task_id']
            rows = self.rows('SELECT t.*,s.scope_json AS session_scope_json,s.version AS session_version,s.deleted_at FROM research_tasks t JOIN research_sessions s ON s.id=t.session_id WHERE t.id=?', (tid,))
            if not rows or rows[0]['deleted_at']:
                raise HTTPException(409, detail='PROPOSAL_STALE')
            row = rows[0]
            status, error = row['status'], row.get('error_code')
            ended_ok = status in ('running', 'completed', 'interrupted')
            if status == 'failed':
                ended_ok = error not in ('CONTEXT_CHANGED', 'MEMORY_CHANGED', 'SOURCE_UNAVAILABLE')
            if status == 'cancelled':
                ended_ok = error not in ('CONTEXT_CHANGED', 'MEMORY_CHANGED', 'SESSION_DELETED')
            if not ended_ok:
                raise HTTPException(409, detail='PROPOSAL_STALE')
            scope = json.loads(row['session_scope_json'])
            from .research_memory import ResearchMemory
            memory = ResearchMemory(self.library)
            if not memory.history_allowed(tid, row['session_id']): raise HTTPException(409, detail='PROPOSAL_STALE')
            from .providers import ProbeError
            try: tools = ResearchTools(self.library, scope)
            except ProbeError: raise HTTPException(409, detail='PROPOSAL_STALE') from None
            keys = ['global'] + [t['id'] for t in tools.initial['topics']]
            return {'mode': scope.get('mode', 'workspace'),
                    'session_version': row['session_version'], 'scope': tools.initial,
                    'memory': memory_versions(keys)}
        if origin.get('topic_id'):
            return {'topic': self.entity('topic', origin['topic_id']),'memory':memory_versions(['global',origin['topic_id']])}
        doc = self.entity('document', origin['document_id'])
        context={'document_version': doc['version'], 'extraction_version': doc['extraction_version'],'memory':memory_versions(['global'])}
        if origin.get('enrichment_id'):
            rows=self.rows('SELECT * FROM document_enrichments WHERE id=? AND document_id=? AND hidden=0 AND extraction_version=?',(origin['enrichment_id'],doc['id'],doc['extraction_version']))
            if not rows:raise HTTPException(409,detail='SOURCE_UNAVAILABLE')
            context['enrichment']=digest(rows[0])
        return context

    def origin_scope(self, origin):
        if origin.get('task_id'):
            return json.loads(self.rows('SELECT scope_json FROM research_sessions WHERE id=(SELECT session_id FROM research_tasks WHERE id=?)', (origin['task_id'],))[0]['scope_json'])
        if origin.get('topic_id'):
            return {'mode': 'topic', 'topic_id': origin['topic_id']}
        return {'mode': 'workspace', 'topic_id': None}

    def folder_snapshots(self, dependencies, origin):
        """Record actual folder names, paths and direct members. Additions matter only
        when the proposal declared that it depends on all current members."""
        if not dependencies: return []
        tools = ResearchTools(self.library, self.origin_scope(origin))
        result = []
        for dependency in dependencies:
            try: result.append(tools.catalog.folder_dependency(str(dependency.folder_id)))
            except ProbeError:
                detail = 'OUT_OF_SCOPE' if self.origin_scope(origin)['mode'] == 'topic' else 'FOLDER_NOT_FOUND'
                raise HTTPException(409, detail=detail) from None
        return result

    @staticmethod
    def scope_signature(context):
        """Scope identity for stale checks: unrelated document growth is not a scope change.

        Topic scope still includes documents and notes because linking new materials
        changes what the session may read. Workspace scope covers every document, so
        only topics and notebook heads are compared.
        """
        scope = context.get('scope')
        if not scope: return context
        mode = context.get('mode')
        keys = ['topics', 'notebooks'] + (['documents', 'notes'] if mode == 'topic' else [])
        signature = {'mode': mode}
        for key in keys:
            signature[key] = sorted(row['id'] for row in scope.get(key, []))
        return {**{key: value for key, value in context.items() if key not in ('scope', 'mode')},
                'scope': signature, 'mode': mode}

    def valid_sources(self, sources, origin):
        if not sources: return
        scope = {'mode': 'workspace'}
        if origin.get('task_id'):
            scope = json.loads(self.rows('SELECT scope_json FROM research_sessions WHERE id=(SELECT session_id FROM research_tasks WHERE id=?)', (origin['task_id'],))[0]['scope_json'])
        tools = ResearchTools(self.library, scope)
        if not all(tools.available(s) for s in sources): raise HTTPException(409, detail='SOURCE_UNAVAILABLE')

    def preview(self, value, *, sources=None, rewrite_allowed=False):
        origin = {'task_id': str(value.task_id)} if value.task_id else {'document_id': str(value.document_id)} if value.document_id else {'topic_id': str(value.topic_id)} if value.topic_id else None
        if origin is None: raise HTTPException(422, detail='INVALID_INPUT')
        if sum(bool(v) for v in (value.task_id,value.document_id,value.topic_id))!=1: raise HTTPException(422, detail='INVALID_INPUT')
        if value.enrichment_id:
            if not value.document_id:raise HTTPException(422,detail='INVALID_INPUT')
            origin['enrichment_id']=value.enrichment_id
        with self.db.write() as conn:
            existing = self.rows('SELECT id,origin_json,operations_json,guards_json FROM collaboration_proposals WHERE request_id=?', (str(value.request_id),))
            specs = [o.model_dump() for o in value.operations]
            requested = [str(d.folder_id) for d in value.dependencies]
            if existing:
                stored = json.loads(existing[0]['guards_json']).get('requested_folders', [])
                if json.loads(existing[0]['origin_json']) != origin or [self.spec(o) for o in json.loads(existing[0]['operations_json'])] != specs or stored != requested:
                    raise HTTPException(409, detail='IDEMPOTENCY_CONFLICT')
                return self.get(existing[0]['id'])
            context = self.context(origin)
            if sources is None:
                sources = json.loads(self.rows('SELECT sources_json FROM research_tasks WHERE id=?', (origin['task_id'],))[0]['sources_json']) if value.task_id else []
                if value.enrichment_id:
                    result=json.loads(self.rows('SELECT result_json FROM document_enrichments WHERE id=?',(value.enrichment_id,))[0]['result_json'])
                    tools=ResearchTools(self.library,{'mode':'workspace'})
                    for block in result.get('evidence_ids',[])[:16]:
                        source=tools.resolve('document',block)
                        text=source.pop('text')[:1800]
                        sources.append({**source,'text':text,'start':0,'hash':digest(text),'citation':'S'+str(len(sources)+1)})
            self.valid_sources(sources, origin)
            folders = self.folder_snapshots(value.dependencies, origin)
            question = self.rows('SELECT question FROM research_tasks WHERE id=?', (origin['task_id'],))[0]['question'] if value.task_id else ''
            can_rewrite = rewrite_allowed or bool(re.search(r'重写|替换|rewrite|replace', question, re.I))
            known = {}; operations = []; guards = {}; mutated = set()
            allowed = context.get('scope')
            def reference(ref, kind):
                if ref.startswith('$'):
                    op = known.get(ref[1:])
                    expected = 'create_topic' if kind == 'topic' else 'create_note'
                    if not op or op['action'] != expected: raise HTTPException(422, detail='INVALID_DEPENDENCY')
                    return ref[1:]
                try: UUID(ref)
                except (ValueError, TypeError): raise HTTPException(422, detail='INVALID_INPUT') from None
                entity = self.entity(kind, ref)
                if allowed:
                    permitted = {r['id'] for r in allowed['documents' if kind == 'document' else 'topics' if kind == 'topic' else 'notes']} | ({r['id'] for r in allowed['notebooks']} if kind == 'note' else set())
                    if ref not in permitted: raise HTTPException(409, detail='OUT_OF_SCOPE')
                guards[kind + ':' + ref] = self.guard(kind, ref)
                return None
            for op in specs:
                if op['key'] in known: raise HTTPException(422, detail='INVALID_DEPENDENCY')
                deps = []; before = ''; owner_title = ''
                if op['action'] == 'create_topic':
                    if not op['title'] or op['body_md']: raise HTTPException(422, detail='INVALID_INPUT')
                    if op['owner']: deps.append(reference(op['owner'], 'topic'))
                elif op['action'] == 'create_note':
                    if not op['title'] or not op['body_md'].strip(): raise HTTPException(422, detail='INVALID_INPUT')
                    deps.append(reference(op['owner'], 'topic'))
                    if not op['owner'].startswith('$'): owner_title = self.entity('topic', op['owner'])['title']
                elif op['action'] in ('append_note', 'rewrite_note'):
                    if not op['body_md'].strip(): raise HTTPException(422, detail='INVALID_INPUT')
                    deps.append(reference(op['target'], 'note')); note = self.entity('note', op['target']); before = note['body_md']
                    if op['target_version'] is not None and op['target_version']!=note['version']:raise HTTPException(409,detail='MATERIAL_CHANGED')
                    if op['target'] in mutated: raise HTTPException(422, detail='DUPLICATE_TARGET')
                    mutated.add(op['target'])
                    if op['action'] == 'rewrite_note' and not (rewrite_allowed or (can_rewrite and (op['target'] in question or (note.get('title') and note['title'] in question)))):
                        raise HTTPException(422, detail='REWRITE_NOT_EXPLICIT')
                    op['target_title']=note.get('title') or '文献笔记'
                    owner_title = self.entity('topic', note['topic_id'])['title'] if note['kind'] == 'topic_note' else self.entity('document', note['document_id'])['title']
                else:
                    pair=tuple(sorted(((op['first_kind'],op['first']),(op['second_kind'],op['second']))))
                    if pair in mutated:raise HTTPException(422,detail='DUPLICATE_TARGET')
                    mutated.add(pair)
                    deps += [reference(op['first'], op['first_kind']), reference(op['second'], op['second_kind'])]
                    for side in ('first','second'):
                        ref=op[side]
                        entity=known[ref[1:]] if ref.startswith('$') else self.entity(op[side+'_kind'],ref)
                        if not ref.startswith('$') and op[side+'_version'] is not None and op[side+'_version']!=entity['version']:raise HTTPException(409,detail='MATERIAL_CHANGED')
                        op[side+'_title']=entity.get('title') or entity.get('original_name') or ref
                    if not op['first'].startswith('$') and not op['second'].startswith('$'):
                        state = self.relations.state(op['first_kind'], op['first'], op['second_kind'], op['second'])
                        op['before_relation'] = state
                if op['body_md'] and any(int(n) < 1 or int(n) > len(sources) for n in re.findall(r'\[S(\d+)\]', op['body_md'])):
                    raise HTTPException(422, detail='INVALID_CITATION')
                incoming=op['body_md']
                offset=0
                if op['action']=='append_note':
                    offset=len(json.loads(note['sources_json']))
                    incoming=re.sub(r'\[S(\d+)\]',lambda m:'[S'+str(int(m[1])+offset)+']',incoming)
                after = before + '\n\n' + incoming if op['action'] == 'append_note' else incoming
                if len(after) > 200000: raise HTTPException(422, detail='CONTEXT_TOO_LARGE')
                op.update(depends_on=list(dict.fromkeys(d for d in deps if d)), before_body=before,
                          after_body=after, owner_title=owner_title,
                          source_citations=[f'S{index+offset}' for index in range(1,len(sources)+1)],
                          source_offset=offset,
                          diff='\n'.join(difflib.unified_diff(before.splitlines(), after.splitlines(), fromfile='当前', tofile='建议',lineterm='')),
                          object_id=str(uuid4()) if op['action'].startswith('create_') else op['target'])
                known[op['key']] = op; operations.append(op)
            identity = str(uuid4()); stamp = now()
            conn.execute('INSERT INTO collaboration_proposals(id,request_id,origin_json,operations_json,sources_json,guards_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                         (identity, str(value.request_id), json.dumps(origin), json.dumps(operations, ensure_ascii=False), json.dumps(sources, ensure_ascii=False), json.dumps({'context': context, 'objects': list(guards.values()), 'folders': folders, 'requested_folders': requested}), stamp, stamp))
            return self.get(identity)

    @staticmethod
    def spec(op): return {k: op[k] for k in Operation.model_fields}

    def get(self, identity, *, detail=False):
        rows = self.rows('SELECT * FROM collaboration_proposals WHERE id=?', (identity,))
        if not rows: raise HTTPException(404, detail='PROPOSAL_NOT_FOUND')
        item = rows[0]
        for key in ('origin', 'operations', 'sources', 'guards', 'decision'):
            item[key] = json.loads(item.pop(key + '_json')) if item[key + '_json'] else None
        try: self.check(item); item['stale'] = False; item['conflict'] = None
        except HTTPException as error: item['stale'] = True; item['conflict'] = error.detail
        guards = item['guards'] or {}
        if detail and item['stale']:
            try: item['conflict_objects'] = self.conflict_objects(item, guards)
            except Exception: item['conflict_objects'] = []
        item.pop('guards')
        item['dependencies'] = [{'folder_id': folder['folder_id'], 'name': folder['name'],
                                 'path': folder['path'], 'version': folder['version'],
                                 'member_count': len(folder['members'])}
                                for folder in guards.get('folders', [])]
        if detail:
            item['decisions'] = self.decision_history(identity)
            self.enrich_detail(item)
        return item

    def object_title(self, kind, identity):
        if kind == 'document':
            rows = self.rows('SELECT title,original_name FROM documents WHERE id=? AND deleted_at IS NULL', (identity,))
            return (rows[0]['title'] or rows[0]['original_name']) if rows else identity
        if kind == 'topic':
            rows = self.rows('SELECT title FROM topics WHERE id=? AND deleted_at IS NULL', (identity,))
            return rows[0]['title'] if rows else identity
        meta = self.note_meta(identity)
        return meta.get('target_title') or meta.get('target_path') or identity

    def conflict_objects(self, item, guards):
        objects = []
        def add(kind, identity, title, reason):
            marker = (kind, identity)
            if not any((entry.get('kind'), entry.get('id')) == marker for entry in objects):
                objects.append({'kind': kind, 'id': identity, 'title': title or identity, 'reason': reason})
        try: context = self.context(item['origin'])
        except HTTPException: context = {}
        if self.scope_signature(context) != self.scope_signature(guards.get('context') or {}):
            add('context', None, '研究范围或研究背景', 'context_changed')
        try: tools = ResearchTools(self.library, self.origin_scope(item['origin']))
        except Exception: tools = None
        if tools:
            for source in item.get('sources') or []:
                if not tools.available(source):
                    add(source.get('kind'), source.get('object_id'), source.get('title'), 'source_unavailable')
        for guard in guards.get('objects', []):
            try: current = self.guard(guard['kind'], guard['id'])
            except HTTPException: current = None
            if current != guard:
                add(guard['kind'], guard['id'], self.object_title(guard['kind'], guard['id']), 'object_changed')
        if tools:
            for folder in guards.get('folders', []):
                try: current = tools.catalog.folder_dependency(folder['folder_id'])
                except ProbeError: add('folder', folder['folder_id'], folder.get('path'), 'folder_unavailable'); continue
                if (current['name'] != folder['name'] or current['path'] != folder['path'] or
                        {member['id'] for member in current['members']} != {member['id'] for member in folder['members']}):
                    add('folder', folder['folder_id'], folder.get('path'), 'folder_changed')
        for operation in item.get('operations') or []:
            if 'before_relation' not in operation: continue
            try: state = self.relations.state(operation['first_kind'], operation['first'], operation['second_kind'], operation['second'])
            except HTTPException: state = None
            if state != operation['before_relation']:
                add('relation', None, f"{operation.get('first_title') or operation.get('first')} 与 {operation.get('second_title') or operation.get('second')}", 'relation_changed')
        return objects[:20]

    def decision_history(self, identity):
        rows = self.rows('SELECT request_id,action,payload_json,result_json,created_at FROM collaboration_decisions WHERE proposal_id=? ORDER BY created_at,request_id', (identity,))
        history = []
        for row in rows:
            payload = json.loads(row['payload_json']); result = json.loads(row['result_json'])
            history.append({'request_id': row['request_id'], 'action': row['action'],
                            'selected': payload.get('selected', []), 'status': result.get('status'),
                            'created_at': row['created_at']})
        return history

    def path_maps(self):
        folders = {row['id']: row for row in self.rows('SELECT id,parent_id,name FROM library_folders')}
        topics = {row['id']: row for row in self.rows('SELECT id,parent_id,title FROM topics WHERE deleted_at IS NULL AND notebook_only=0')}
        def folder_path(identity):
            parts, seen, cursor = [], set(), identity
            while cursor and cursor in folders and cursor not in seen:
                seen.add(cursor); parts.append(folders[cursor]['name'])
                cursor = folders[cursor]['parent_id']
            return '/'.join(reversed(parts))
        def topic_path(identity):
            parts, seen, cursor = [], set(), identity
            while cursor and cursor in topics and cursor not in seen:
                seen.add(cursor); parts.append(topics[cursor]['title'])
                cursor = topics[cursor]['parent_id']
            return ' / '.join(reversed(parts))
        return folder_path, topic_path

    def note_meta(self, identity):
        rows = self.rows('SELECT n.id,n.title,o.id AS topic_id,o.title AS owner_title FROM topic_notebooks n JOIN topics o ON o.id=n.topic_id JOIN topics h ON h.id=n.id WHERE n.id=? AND n.deleted_at IS NULL AND h.deleted_at IS NULL AND o.deleted_at IS NULL', (identity,))
        _, topic_path = self.path_maps()
        if rows:
            row = rows[0]; title = row['title'] or row['owner_title']
            return {'target_kind': 'topic_note', 'target_path': topic_path(row['topic_id']),
                    'target_title': title, 'target_topic_id': row['topic_id']}
        rows = self.rows('SELECT n.id,d.id AS document_id,d.title,d.original_name FROM notes n JOIN documents d ON d.id=n.document_id WHERE n.id=? AND d.deleted_at IS NULL', (identity,))
        if rows:
            row = rows[0]
            return {'target_kind': 'reading_note', 'target_path': row['title'] or row['original_name'],
                    'target_title': '阅读笔记', 'target_document_id': row['document_id']}
        return {}

    def enrich_detail(self, item):
        folder_path, topic_path = self.path_maps()
        for operation in item['operations']:
            for side in ('first', 'second'):
                kind, ref = operation.get(side + '_kind'), operation.get(side)
                if not ref or str(ref).startswith('$'): continue
                if kind == 'document':
                    rows = self.rows('SELECT title,original_name,folder_id FROM documents WHERE id=? AND deleted_at IS NULL', (ref,))
                    if rows:
                        folder = folder_path(rows[0]['folder_id']) if rows[0]['folder_id'] else ''
                        operation[side + '_path'] = (folder + '/' if folder else '') + rows[0]['original_name']
                elif kind == 'topic':
                    operation[side + '_path'] = topic_path(ref)
            if operation.get('owner') and not str(operation['owner']).startswith('$'):
                operation['owner_path'] = topic_path(operation['owner'])
            if operation.get('target'):
                operation.update(self.note_meta(operation['target']))
            if operation.get('object_id') and operation['action'] in ('create_topic', 'create_note'):
                operation['pending_object_id'] = operation['object_id']
        decision = item.get('decision')
        if decision:
            for record in decision.get('records', []):
                if record.get('kind') == 'topic':
                    record['navigation'] = {'module': 'Garden', 'tab': 'topic', 'id': record.get('id')}
                elif record.get('kind') == 'note':
                    meta = self.note_meta(record.get('id'))
                    if meta.get('target_kind') == 'topic_note':
                        record['navigation'] = {'module': 'Garden', 'tab': 'topic-note', 'id': record.get('id')}
                    elif meta.get('target_kind') == 'reading_note':
                        record['navigation'] = {'module': 'Storage', 'tab': 'notes', 'id': meta.get('target_document_id'), 'note_id': record.get('id')}
                elif record.get('kind') == 'relation':
                    for side in ('first', 'second'):
                        kind, identity = record.get(side + '_kind'), record.get(side)
                        if kind == 'topic':
                            record[side + '_navigation'] = {'module': 'Garden', 'tab': 'topic', 'id': identity}
                        elif kind == 'document':
                            record[side + '_navigation'] = {'module': 'Storage', 'tab': 'document', 'id': identity}

    def raw(self, identity):
        item = self.get(identity)
        item['guards'] = json.loads(self.rows('SELECT guards_json FROM collaboration_proposals WHERE id=?', (identity,))[0]['guards_json'])
        return item

    def check(self, item):
        if item['status'] != 'pending': return
        if self.scope_signature(self.context(item['origin'])) != self.scope_signature(item['guards']['context']):
            raise HTTPException(409, detail='PROPOSAL_STALE')
        self.valid_sources(item['sources'], item['origin'])
        for dependency in item['guards'].get('folders', []):
            tools = ResearchTools(self.library, self.origin_scope(item['origin']))
            try: current = tools.catalog.folder_dependency(dependency['folder_id'])
            except ProbeError: raise HTTPException(409, detail='PROPOSAL_STALE') from None
            if (current['name'] != dependency['name'] or current['path'] != dependency['path'] or
                    {member['id'] for member in current['members']} != {member['id'] for member in dependency['members']}):
                raise HTTPException(409, detail='PROPOSAL_STALE')
        for guard in item['guards']['objects']:
            if self.guard(guard['kind'], guard['id']) != guard: raise HTTPException(409, detail='PROPOSAL_STALE')
        for op in item['operations']:
            if 'before_relation' in op and self.relations.state(op['first_kind'], op['first'], op['second_kind'], op['second']) != op['before_relation']:
                raise HTTPException(409, detail='PROPOSAL_STALE')

    def list(self, *, task_id=None, document_id=None, topic_id=None):
        key, value = ('task_id', task_id) if task_id else ('document_id', document_id) if document_id else ('topic_id',topic_id)
        return {'items': [self.get(r['id']) for r in self.rows('SELECT id FROM collaboration_proposals WHERE json_extract(origin_json,?)=? ORDER BY created_at DESC LIMIT 40', ('$.' + key, value))]}

    def write_note(self, conn, identity, body, sources):
        note = self.entity('note', identity); stamp = now()
        if note['kind'] == 'topic_note':
            old = self.rows('SELECT * FROM revisions WHERE id=?', (note['current_revision_id'],))[0]
            rid = str(uuid4())
            conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,sources_json,origin,base_revision_id,created_at) VALUES(?,?,?,?,?,'manual',?,?)", (rid, identity, old['ordinal'] + 1, body, json.dumps(sources, ensure_ascii=False), old['id'], stamp))
            conn.execute('UPDATE topics SET current_revision_id=?,version=version+1,updated_at=? WHERE id=?', (rid, stamp, identity))
            if identity != note['topic_id']: conn.execute('UPDATE topics SET version=version+1,updated_at=? WHERE id=?', (stamp, note['topic_id']))
        else:
            conn.execute('UPDATE notes SET body_md=?,sources_json=?,version=version+1,updated_at=? WHERE id=?', (body, json.dumps(sources, ensure_ascii=False), stamp, identity))

    def apply_op(self, conn, op, known, sources):
        ref = lambda key: known[key[1:]] if key.startswith('$') else key
        stamp = now(); action = op['action']; identity = op['object_id']
        sources=self.formal_sources(sources)
        if action in ('create_topic', 'create_note'):
            parent = ref(op['owner']) if op['owner'] else None
            rid = str(uuid4()); private = int(action == 'create_note')
            conn.execute('INSERT INTO topics(id,parent_id,title,notebook_only,created_at,updated_at) VALUES(?,?,?,?,?,?)', (identity, None if private else parent, op['title'], private, stamp, stamp))
            conn.execute("INSERT INTO revisions(id,topic_id,ordinal,body_md,sources_json,origin,created_at) VALUES(?,?,1,?,?,'manual',?)", (rid, identity, op['after_body'], json.dumps(sources if private else [], ensure_ascii=False), stamp))
            conn.execute('UPDATE topics SET current_revision_id=? WHERE id=?', (rid, identity))
            if private:
                conn.execute('INSERT INTO topic_notebooks(id,topic_id,title,created_at,updated_at) VALUES(?,?,?,?,?)', (identity, parent, op['title'], stamp, stamp))
                conn.execute('UPDATE topics SET version=version+1,updated_at=? WHERE id=?', (stamp, parent))
            else: conn.execute('INSERT INTO topic_note_scope VALUES(?,?,1)', (identity, identity))
            return {'kind': 'note' if private else 'topic', 'id': identity, 'created': True}
        if action in ('append_note', 'rewrite_note'):
            before = self.entity('note', op['target'])
            old_sources = json.loads(before['sources_json'])
            if action=='append_note':
                for index,source in enumerate(sources,len(old_sources)+1):source['source_id']=f'S{index}'
            self.write_note(conn, op['target'], op['after_body'], old_sources + sources if action == 'append_note' else sources)
            return {'kind': 'note', 'id': op['target'], 'before': before}
        first, second = ref(op['first']), ref(op['second'])
        before = self.relations.state(op['first_kind'], first, op['second_kind'], second)
        if action=='unlink':self.relations.remove_with(conn,op['first_kind'],first,op['second_kind'],second)
        else:self.relations.link_with(conn, op['first_kind'], first, op['second_kind'], second, op['reason'])
        return {'kind': 'relation', 'first_kind': op['first_kind'], 'first': first, 'second_kind': op['second_kind'], 'second': second, 'before': before}

    def formal_sources(self,sources):
        from .source_status import resolve_evidence
        result=[]
        for index,source in enumerate(sources,1):
            kind=source['kind'];document=kind=='document'
            item={'source_id':f'S{index}','kind':'wiki' if kind=='topic' else kind,
                  'source_object_id':source['document_id'] if document else source['object_id'],
                  'source_version':source['version'],'excerpt':source['text'],'evidence':[]}
            if document:
                evidence=resolve_evidence(self.db,{'document_id':source['document_id'],'block_id':source['block_id'],'extraction_version':int(source['version']),'quote':source['text']})
                if not evidence:raise HTTPException(409,detail='SOURCE_UNAVAILABLE')
                item['evidence']=[evidence]
            else:item['notebook_snapshot']=True
            result.append(item)
        return result

    def result_state(self, record):
        if record['kind'] == 'relation': return self.relations.state(record['first_kind'], record['first'], record['second_kind'], record['second'])
        return self.entity(record['kind'], record['id'])

    def decide(self, identity, value, action):
        payload = value.model_dump(mode='json'); rid = str(value.request_id)
        with self.db.write() as conn:
            old = self.rows('SELECT * FROM collaboration_decisions WHERE request_id=?', (rid,))
            if old:
                row = old[0]
                if row['proposal_id'] != identity or row['action'] != action or json.loads(row['payload_json']) != payload: raise HTTPException(409, detail='IDEMPOTENCY_CONFLICT')
                return self.get(identity)
            item = self.raw(identity)
            if item['version'] != value.version: raise HTTPException(409, detail='PROPOSAL_CONFLICT')
            if action == 'undo':
                if item['status'] != 'accepted': raise HTTPException(409, detail='PROPOSAL_CONFLICT')
                records = item['decision']['records']
                for record in records:
                    if self.result_state(record) != record['after']: raise HTTPException(409, detail='UNDO_CONFLICT')
                self.check_new_dependencies(records)
                for record in reversed(records): self.undo_op(conn, record)
                decision = {**item['decision'], 'undone_at': now()}; status = 'undone'
            else:
                if item['status'] != 'pending': raise HTTPException(409, detail='PROPOSAL_CONFLICT')
                if action == 'reject': decision = {'selected': [], 'records': []}; status = 'rejected'
                else:
                    self.check(item)
                    chosen = set(value.selected); keys = {op['key'] for op in item['operations']}
                    if not chosen <= keys: raise HTTPException(422, detail='INVALID_SELECTION')
                    # Deselecting prerequisites deterministically deselects dependents.
                    effective = []; skipped = []
                    for op in item['operations']:
                        if op['key'] in chosen:
                            if set(op['depends_on']) <= set(effective): effective.append(op['key'])
                            else: skipped.append(op['key'])
                    if not effective: raise HTTPException(422, detail='EMPTY_SELECTION')
                    records = []; known = {o['key']: o['object_id'] for o in item['operations']}
                    for op in item['operations']:
                        if op['key'] in effective: records.append(self.apply_op(conn, op, known, item['sources']))
                    for record in records: record['after'] = self.result_state(record)
                    decision = {'selected': effective, 'skipped_dependencies': skipped, 'records': records}; status = 'accepted'
            stamp = now()
            conn.execute('UPDATE collaboration_proposals SET status=?,version=version+1,decision_json=?,updated_at=? WHERE id=?', (status, json.dumps(decision, ensure_ascii=False), stamp, identity))
            conn.execute('INSERT INTO collaboration_decisions VALUES(?,?,?,?,?,?)', (rid, identity, action, json.dumps(payload), json.dumps({'status': status}), stamp))
            return self.get(identity)

    def check_new_dependencies(self, records):
        """Conservative reverse-reference check over current formal content only."""
        created = {r['id'] for r in records if r.get('created')}
        relation_records = [r for r in records if r['kind'] == 'relation']
        for record in records:
            if not record.get('created'): continue
            identity = record['id']
            if record['kind'] == 'topic':
                children = self.rows('SELECT id FROM topics WHERE parent_id=? AND deleted_at IS NULL', (identity,))
                notes = self.rows('SELECT id FROM topic_notebooks WHERE topic_id=? AND deleted_at IS NULL', (identity,))
                if any(r['id'] not in created for r in children + notes): raise HTTPException(409, detail='UNDO_DEPENDENCY')
                links = self.rows('SELECT document_id FROM document_topics WHERE topic_id=?', (identity,))
                expected_docs = {r['first'] if r['first_kind'] == 'document' else r['second'] for r in relation_records if (r['first'] == identity or r['second'] == identity) and r['first_kind'] != r['second_kind']}
                if any(r['document_id'] not in expected_docs for r in links): raise HTTPException(409, detail='UNDO_DEPENDENCY')
                rels = self.rows('SELECT low_id,high_id FROM topic_relations WHERE low_id=? OR high_id=?', (identity, identity))
                expected = {tuple(sorted((r['first'], r['second']))) for r in relation_records if r['first_kind'] == r['second_kind'] == 'topic'}
                if any((r['low_id'], r['high_id']) not in expected for r in rels): raise HTTPException(409, detail='UNDO_DEPENDENCY')
                scope = self.rows('SELECT topic_id FROM topic_note_scope WHERE source_topic_id=?', (identity,))
                if any(r['topic_id'] not in created for r in scope): raise HTTPException(409, detail='UNDO_DEPENDENCY')
            # IDs in current sources/body count as references, never silently delete them.
            for row in self.rows('SELECT t.id,r.body_md,r.sources_json FROM topics t JOIN revisions r ON r.id=t.current_revision_id WHERE t.deleted_at IS NULL'):
                if row['id'] not in created and identity in row['body_md'] + row['sources_json']: raise HTTPException(409, detail='UNDO_DEPENDENCY')
            for row in self.rows('SELECT n.body_md,n.sources_json FROM notes n JOIN documents d ON d.id=n.document_id WHERE d.deleted_at IS NULL'):
                if identity in row['body_md'] + row['sources_json']: raise HTTPException(409, detail='UNDO_DEPENDENCY')
            for row in self.rows('SELECT coalesce(summary_md,\'\') AS body FROM documents WHERE deleted_at IS NULL'):
                if identity in row['body']:raise HTTPException(409,detail='UNDO_DEPENDENCY')
            for row in self.rows("SELECT sources_json FROM research_tasks WHERE status='completed' UNION ALL SELECT sources_json FROM messages WHERE status='completed'"):
                if identity in row['sources_json']:raise HTTPException(409,detail='UNDO_DEPENDENCY')

    def undo_op(self, conn, record):
        if record['kind'] == 'relation':
            if record['before']:
                self.relations.link_with(conn, record['first_kind'], record['first'], record['second_kind'], record['second'], record['before'][0].get('description', ''))
            else: self.relations.remove_with(conn, record['first_kind'], record['first'], record['second_kind'], record['second'])
        elif record.get('created'):
            stamp = now()
            if record['kind'] == 'note': conn.execute('UPDATE topic_notebooks SET deleted_at=?,updated_at=? WHERE id=?', (stamp, stamp, record['id']))
            else: conn.execute('DELETE FROM topic_note_scope WHERE topic_id=?', (record['id'],))
            conn.execute('UPDATE topics SET deleted_at=?,version=version+1,updated_at=? WHERE id=?', (stamp, stamp, record['id']))
        else:
            self.write_note(conn, record['id'], record['before']['body_md'], json.loads(record['before']['sources_json']))

    def repair(self, identity, request_id):
        item = self.raw(identity)
        if item['status']!='pending':raise HTTPException(409,detail='PROPOSAL_CONFLICT')
        # Repair is a fresh preview only; stale evidence/context is never silently rebased.
        self.valid_sources(item['sources'], item['origin'])
        context=self.context(item['origin']);before=item['guards']['context']
        if context['memory']!=before['memory']:raise HTTPException(409,detail='RESEARCH_AGAIN_REQUIRED')
        if item['origin'].get('task_id'):
            if context['session_version']!=before['session_version'] or context['memory']!=before['memory']:
                raise HTTPException(409,detail='RESEARCH_AGAIN_REQUIRED')
            if any({r['id'] for r in context['scope'][k]}!={r['id'] for r in before['scope'][k]} for k in context['scope']):
                raise HTTPException(409,detail='RESEARCH_AGAIN_REQUIRED')
        for op in item['operations']:
            for field in ('first_version','second_version','target_version'):op[field]=None
        value = Preview(request_id=request_id, **item['origin'], operations=[Operation(**self.spec(op)) for op in item['operations']],
                        dependencies=[FolderDependency(folder_id=dependency['folder_id']) for dependency in item.get('dependencies', [])])
        return self.preview(value, sources=item['sources'])


def router(service):
    routes = APIRouter()
    @routes.get('/v1/collaboration/proposals')
    def listing(task_id: UUID | None = None, document_id: UUID | None = None, topic_id: UUID | None = None):
        if not task_id and not document_id and not topic_id: raise HTTPException(422, detail='INVALID_INPUT')
        return service.list(task_id=str(task_id) if task_id else None, document_id=str(document_id) if document_id else None,topic_id=str(topic_id) if topic_id else None)
    @routes.post('/v1/collaboration/preview')
    def preview(value: Preview): return service.preview(value)
    @routes.get('/v1/collaboration/proposals/{identity}')
    def view(identity: UUID): return service.get(str(identity), detail=True)
    @routes.post('/v1/collaboration/proposals/{identity}/{action}')
    def decide(identity: UUID, action: Literal['accept', 'reject', 'undo', 'repair'], value: Decision):
        return service.repair(str(identity), value.request_id) if action == 'repair' else service.decide(str(identity), value, action)
    @routes.get('/v1/collaboration/candidates/{kind}/{identity}')
    def candidates(kind: Literal['document', 'topic'], identity: UUID, query: str = ''):
        if len(query) > 200: raise HTTPException(422, detail='INVALID_INPUT')
        return service.relations.candidates(kind, str(identity), query)
    @routes.get('/v1/collaboration/topics/{identity}/relations')
    def relations(identity: UUID): return service.relations.topics(str(identity))
    return routes

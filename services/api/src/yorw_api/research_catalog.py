"""Scope-aware Storage directory and object reads for the research assistant.

Directories are user organization, not paper evidence: these tools only describe
names, paths, membership and versions. Original text stays behind search_local and
read_local, and every read is filtered by the session's current scope.
"""
import json
from fastapi import HTTPException
from .providers import ProbeError
from .tool_errors import ToolFault

PAGE_SIZE = 50
MAX_PAGE_SIZE = 50
MAX_SUMMARY = 4000
UUID_PATTERN = r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'


def navigation(kind, identity, title, *, document_id=None):
    """Stable, server-generated navigation target; never accepts a model URL."""
    if kind == 'document':
        return {'module': 'Storage', 'tab': 'document', 'id': identity, 'title': title}
    if kind == 'reading_note':
        return {'module': 'Storage', 'tab': 'notes', 'id': document_id, 'title': title}
    if kind == 'topic':
        return {'module': 'Garden', 'tab': 'topic', 'id': identity, 'title': title}
    if kind == 'topic_note':
        return {'module': 'Garden', 'tab': 'topic-note', 'id': identity, 'title': title}
    if kind == 'folder':
        return {'module': 'Storage', 'tab': 'library', 'id': identity, 'title': title}
    if kind == 'proposal':
        return {'module': 'Garden', 'tab': 'proposal', 'id': identity, 'title': title}
    raise ValueError(kind)


class CatalogReader:
    def __init__(self, library, snapshot, scope, *, session_id=None, task_id=None):
        self.library, self.db = library, library.db
        self.snapshot, self.scope = snapshot, scope
        self.session_id, self.task_id = session_id, task_id
        self.document_ids = {row['id'] for row in snapshot['documents']}
        self.topic_ids = {row['id'] for row in snapshot['topics']}
        self.notebook_ids = {row['id'] for row in snapshot['notebooks']}

    def rows(self, sql, args=()):
        return self.library.rows(sql, args)

    # --- directory model -------------------------------------------------
    def maps(self):
        rows = self.rows('SELECT id,parent_id,name,version FROM library_folders')
        by = {row['id']: row for row in rows}
        folder_of = {row['id']: row['folder_id'] for row in self.rows(
            'SELECT id,folder_id FROM documents WHERE deleted_at IS NULL')}
        def path(identity):
            parts, seen, cursor = [], set(), identity
            while cursor and cursor in by and cursor not in seen:
                seen.add(cursor); parts.append(by[cursor]['name'])
                cursor = by[cursor]['parent_id']
            return '/'.join(reversed(parts))
        return by, folder_of, path

    def visible(self, by, folder_of):
        """Visible folders plus per-folder visible subtree counts."""
        if self.scope['mode'] == 'workspace':
            folders = set(by)
        else:
            folders = set()
            for identity in self.document_ids:
                cursor, seen = folder_of.get(identity), set()
                while cursor and cursor in by and cursor not in seen:
                    seen.add(cursor); folders.add(cursor)
                    cursor = by[cursor]['parent_id']
        documents = {identity: folder_of.get(identity) for identity in self.document_ids}
        doc_count = {identity: 0 for identity in folders}
        folder_count = {identity: 0 for identity in folders}
        for folder in documents.values():
            seen = set()
            while folder and folder in folders and folder not in seen:
                seen.add(folder); doc_count[folder] += 1
                folder = by[folder]['parent_id']
        for identity in folders:
            cursor, seen = by[identity]['parent_id'], set()
            while cursor and cursor in folders and cursor not in seen:
                seen.add(cursor); folder_count[cursor] += 1
                cursor = by[cursor]['parent_id']
        return folders, documents, doc_count, folder_count

    def folder_dependency(self, identity):
        """Snapshot the folder name, path and current subtree member IDs."""
        with self.db.lock:
            by, folder_of, path = self.maps()
            folders, _, _, _ = self.visible(by, folder_of)
            if identity not in folders:
                raise ProbeError('FOLDER_NOT_FOUND')
            def inside(folder):
                cursor, seen = folder, set()
                while cursor and cursor in by and cursor not in seen:
                    if cursor == identity: return True
                    seen.add(cursor); cursor = by[cursor]['parent_id']
                return False
            versions = {row['id']: row['version'] for row in self.rows('SELECT id,version FROM documents WHERE deleted_at IS NULL')}
            if self.scope['mode'] == 'topic':
                versions = {key: value for key, value in versions.items() if key in self.document_ids}
            members = [{'id': key, 'version': version} for key, version in versions.items()
                       if inside(folder_of.get(key))]
            members.sort(key=lambda item: item['id'])
            return {'kind': 'folder_members', 'folder_id': identity,
                    'name': by[identity]['name'], 'path': path(identity),
                    'version': by[identity]['version'], 'members': members}

    def document_rows(self, identities):
        identities = list(identities)
        if not identities:
            return {}
        marks = ','.join('?' for _ in identities)
        rows = self.rows(f'SELECT id,title,original_name,folder_id,version,extraction_version,extraction_status,parse_status,parse_warning,page_count,last_page FROM documents WHERE deleted_at IS NULL AND id IN ({marks})', tuple(identities))
        readable = self.readable(identities)
        return {row['id']: {**row, 'body_readable': row['id'] in readable} for row in rows}

    def readable(self, identities):
        if not identities:
            return set()
        marks = ','.join('?' for _ in identities)
        rows = self.rows(f'SELECT DISTINCT b.document_id FROM document_blocks b JOIN documents d ON d.id=b.document_id AND d.extraction_version=b.extraction_version WHERE b.document_id IN ({marks})', tuple(identities))
        return {row['document_id'] for row in rows}

    def document_item(self, row, path):
        folder = row['folder_id']
        folder_path = path(folder) if folder else ''
        name = row['title'] or row['original_name']
        return {'kind': 'document', 'id': row['id'], 'title': name,
                'original_name': row['original_name'],
                'path': (folder_path + '/' if folder_path else '') + row['original_name'],
                'folder_id': folder, 'folder_path': folder_path,
                'version': row['version'], 'extraction_version': row['extraction_version'],
                'parse_status': row['parse_status'], 'parse_warning': row['parse_warning'],
                'body_readable': row['body_readable'], 'last_page': row['last_page'],
                'navigation': navigation('document', row['id'], name)}

    def folder_item(self, identity, by, path, doc_count, folder_count):
        record = by[identity]
        return {'kind': 'folder', 'id': identity, 'name': record['name'],
                'path': path(identity), 'version': record['version'],
                'parent_id': record['parent_id'],
                'document_count': doc_count[identity], 'folder_count': folder_count[identity],
                'navigation': navigation('folder', identity, path(identity))}

    def folder_head(self, identity, by, path):
        if identity is None:
            return {'kind': 'folder', 'id': None, 'name': '根目录', 'path': '',
                    'version': None, 'navigation': navigation('folder', None, '根目录')}
        return {'kind': 'folder', 'id': identity, 'name': by[identity]['name'],
                'path': path(identity), 'version': by[identity]['version'],
                'navigation': navigation('folder', identity, path(identity))}

    def browse(self, folder_id=None, page=1, page_size=PAGE_SIZE, recursive=False):
        with self.db.lock:
            return self._browse(folder_id, page, page_size, recursive)

    def _browse(self, folder_id, page, page_size, recursive):
        by, folder_of, path = self.maps()
        folders, documents, doc_count, folder_count = self.visible(by, folder_of)
        if folder_id is not None and folder_id not in folders:
            raise ToolFault('OBJECT_NOT_FOUND', field='folder_id', expected='a visible folder ID')
        if self.scope['mode'] == 'topic' and not documents:
            return {'kind': 'library', 'state': 'scope_empty', 'scope': 'topic',
                    'folder': self.folder_head(None, by, path), 'items': [], 'total': 0,
                    'page': page, 'page_size': page_size, 'next_page': None, 'has_more': False}
        def descendant(identity, parent):
            cursor, seen = identity, set()
            while cursor and cursor in by and cursor not in seen:
                if cursor == parent: return True
                seen.add(cursor); cursor = by[cursor]['parent_id']
            return parent is None
        if recursive:
            selected_folders = [identity for identity in folders if identity != folder_id and descendant(identity, folder_id)]
            selected_docs = [identity for identity, folder in documents.items() if descendant(folder, folder_id)] if folder_id else list(documents)
        else:
            selected_folders = [identity for identity in folders if by[identity]['parent_id'] == folder_id]
            selected_docs = [identity for identity, folder in documents.items() if folder == folder_id]
        selected_folders.sort(key=lambda identity: (by[identity]['name'].casefold(), identity))
        rows = self.document_rows(selected_docs)
        docs = [self.document_item(rows[identity], path) for identity in selected_docs if identity in rows]
        if recursive: docs.sort(key=lambda item: (item['path'].casefold(), item['id']))
        else: docs.sort(key=lambda item: (item['title'].casefold(), item['original_name'].casefold(), item['id']))
        items = [self.folder_item(identity, by, path, doc_count, folder_count) for identity in selected_folders]
        if recursive: items.sort(key=lambda item: (item['path'].casefold(), item['id']))
        items += docs
        total = len(items)
        start = (page - 1) * page_size
        current = items[start:start + page_size]
        return {'kind': 'library', 'state': 'empty' if not total else 'ok',
                'scope': self.scope['mode'], 'folder': self.folder_head(folder_id, by, path),
                'items': current, 'total': total, 'page': page, 'page_size': page_size,
                'next_page': page + 1 if start + page_size < total else None,
                'has_more': start + page_size < total}

    def search(self, query, kind='all', page=1, page_size=PAGE_SIZE):
        with self.db.lock:
            return self._search(query, kind, page, page_size)

    def _search(self, query, kind, page, page_size):
        text = query.casefold()
        by, folder_of, path = self.maps()
        folders, documents, doc_count, folder_count = self.visible(by, folder_of)
        if self.scope['mode'] == 'topic' and not documents:
            return {'kind': 'library_search', 'state': 'scope_empty', 'query': query,
                    'items': [], 'total': 0, 'page': page, 'page_size': page_size, 'next_page': None, 'has_more': False}
        found = []
        if kind in ('all', 'folder'):
            for identity in folders:
                name, full = by[identity]['name'], path(identity)
                fields = []
                if text in name.casefold(): fields.append('folder_name')
                if text in full.casefold(): fields.append('folder_path')
                if fields:
                    found.append({'_kind': 'folder', '_id': identity, '_match': fields})
        if kind in ('all', 'document'):
            rows = self.document_rows(documents)
            for identity, row in rows.items():
                title = (row['title'] or '').casefold()
                original = row['original_name'].casefold()
                fields = []
                if text and text in title: fields.append('document_title')
                if text and text in original: fields.append('document_filename')
                if fields:
                    found.append({'_kind': 'document', '_id': identity, '_match': fields})
        found.sort(key=lambda item: (item['_kind'] != 'folder', item['_id']))
        total = len(found)
        start = (page - 1) * page_size
        current = []
        for entry in found[start:start + page_size]:
            if entry['_kind'] == 'folder':
                item = self.folder_item(entry['_id'], by, path, doc_count, folder_count)
            else:
                row = self.document_rows([entry['_id']]).get(entry['_id'])
                if not row: continue
                item = self.document_item(row, path)
            current.append({**item, 'match_type': entry['_match'][0], 'match_types': entry['_match']})
        return {'kind': 'library_search', 'state': 'empty' if not total else 'ok',
                'query': query, 'items': current, 'total': total, 'page': page,
                'page_size': page_size, 'next_page': page + 1 if start + page_size < total else None,
                'has_more': start + page_size < total}

    # --- object details --------------------------------------------------
    def inspect_document(self, identity):
        if identity not in self.document_ids:
            raise ToolFault('OBJECT_NOT_FOUND', field='id', expected='a visible document ID')
        with self.db.lock:
            rows = self.rows('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL', (identity,))
            if not rows:
                raise ToolFault('OBJECT_NOT_FOUND', field='id', expected='a visible document ID')
            row = rows[0]
            by, _, path = self.maps()
            folder = row['folder_id']
            folder_path = path(folder) if folder else ''
            name = row['title'] or row['original_name']
            tags = [item['tag'] for item in self.rows('SELECT tag FROM document_tags WHERE document_id=? ORDER BY created_at,tag_key', (identity,))]
            readable = bool(self.readable([identity]))
            body = 'readable' if readable else 'empty' if row['extraction_status'] in ('ready', 'partial', 'unsupported') else 'unparsed'
            notes = self.rows('SELECT id,version,updated_at,body_md FROM notes WHERE document_id=? ORDER BY updated_at DESC,id', (identity,))
            related = []
            for relation in self.rows('SELECT low_id,high_id,description FROM document_relations WHERE low_id=? OR high_id=?', (identity, identity)):
                other = relation['high_id'] if relation['low_id'] == identity else relation['low_id']
                if other in self.document_ids:
                    related.append({**relation, 'id': other})
            links = [item for item in self.rows('SELECT dt.topic_id,t.title,t.version FROM document_topics dt JOIN topics t ON t.id=dt.topic_id WHERE dt.document_id=? AND t.deleted_at IS NULL AND t.notebook_only=0', (identity,)) if item['topic_id'] in self.topic_ids]
            related_items = []
            for item in related[:20]:
                brief = self._document_brief(item['id'])
                related_items.append({'kind': 'document', 'id': item['id'], **brief,
                                      'description': item['description'],
                                      'navigation': navigation('document', item['id'], brief['title'])})
            return {'kind': 'document', 'id': identity, 'title': name, 'original_name': row['original_name'],
                    'version': row['version'], 'extraction_version': row['extraction_version'],
                    'folder': {'id': folder, 'path': folder_path,
                               'version': by[folder]['version'] if folder else None},
                    'metadata': {'authors': json.loads(row['authors_json']), 'year': row['year'],
                                 'tags': tags, 'summary_md': (row['summary_md'] or '')[:MAX_SUMMARY],
                                 'summary_truncated': len(row['summary_md'] or '') > MAX_SUMMARY},
                    'parse': {'status': row['parse_status'], 'warning': row['parse_warning'],
                              'extraction_status': row['extraction_status'],
                              'page_count': row['page_count'], 'body_state': body},
                    'notes': [{'kind': 'reading_note', 'id': note['id'], 'version': note['version'],
                               'updated_at': note['updated_at'], 'excerpt': note['body_md'][:240],
                               'navigation': navigation('reading_note', note['id'], '阅读笔记', document_id=identity)}
                              for note in notes[:20]],
                    'note_count': len(notes),
                    'relations': {'documents': related_items,
                                  'document_count': len(related),
                                  'topics': [{'kind': 'topic', 'id': item['topic_id'], 'title': item['title'],
                                              'version': item['version'],
                                              'navigation': navigation('topic', item['topic_id'], item['title'])}
                                             for item in links[:20]],
                                  'topic_count': len(links)},
                    'navigation': navigation('document', identity, name)}

    def _document_brief(self, identity):
        row = self.rows('SELECT title,original_name,version FROM documents WHERE id=? AND deleted_at IS NULL', (identity,))[0]
        return {'title': row['title'] or row['original_name'], 'version': row['version']}

    def inspect_topic(self, identity):
        if identity not in self.topic_ids:
            raise ToolFault('OBJECT_NOT_FOUND', field='id', expected='a visible topic ID')
        with self.db.lock:
            rows = self.rows('SELECT * FROM topics WHERE id=? AND deleted_at IS NULL AND notebook_only=0', (identity,))
            if not rows:
                raise ToolFault('OBJECT_NOT_FOUND', field='id', expected='a visible topic ID')
            topic = rows[0]
            allowed_topics = {row['id']: row for row in self.rows('SELECT id,parent_id,title,version FROM topics WHERE deleted_at IS NULL AND notebook_only=0 ORDER BY title,id') if row['id'] in self.topic_ids}
            def topic_path(value):
                parts, seen, cursor, restricted = [], set(), value, False
                while cursor:
                    if cursor not in allowed_topics or cursor in seen: restricted = True; break
                    seen.add(cursor); parts.append(allowed_topics[cursor]['title'])
                    cursor = allowed_topics[cursor]['parent_id']
                return ' / '.join(reversed(parts)), restricted
            full_path, restricted = topic_path(identity)
            children = [row for row in allowed_topics.values() if row['parent_id'] == identity]
            from .notebooks import selected_topics, notebook_heads
            try:
                selected = selected_topics(self.db, identity)
            except HTTPException:
                raise ProbeError('SOURCE_UNAVAILABLE') from None
            allowed = [item for item in selected if item in self.topic_ids]
            hidden_scope = len(allowed) != len(selected)
            rules = self.rows('SELECT source_topic_id,selected FROM topic_note_scope WHERE topic_id=?', (identity,))
            visible_rules = [rule for rule in rules if rule['source_topic_id'] in self.topic_ids]
            notes = []
            for head in notebook_heads(self.db, allowed):
                record = self.rows('SELECT n.id,n.topic_id,n.title,o.title AS owner_title,t.version,t.updated_at,r.body_md FROM topic_notebooks n JOIN topics t ON t.id=n.id JOIN topics o ON o.id=n.topic_id JOIN revisions r ON r.id=t.current_revision_id WHERE n.id=? AND n.deleted_at IS NULL', (head,))
                if not record: continue
                note = record[0]
                title = note['title'] or note['owner_title']
                notes.append({'kind': 'topic_note', 'id': note['id'], 'title': title,
                              'version': note['version'], 'owner_topic_id': note['topic_id'],
                              'owner_title': note['owner_title'], 'updated_at': note['updated_at'],
                              'excerpt': note['body_md'][:240], 'shared': note['topic_id'] != identity,
                              'navigation': navigation('topic_note', note['id'], title)})
            docs, seen = [], set()
            if allowed:
                marks = ','.join('?' for _ in allowed)
                for link in self.rows(f'SELECT document_id FROM document_topics WHERE topic_id IN ({marks}) ORDER BY document_id', tuple(allowed)):
                    if link['document_id'] in self.document_ids and link['document_id'] not in seen:
                        seen.add(link['document_id']); docs.append(link['document_id'])
            rows_by_id = self.document_rows(docs)
            _, _, path = self.maps()
            materials = [self.document_item(rows_by_id[item], path) for item in docs[:30] if item in rows_by_id]
            reading = []
            if docs:
                marks = ','.join('?' for _ in docs)
                reading = [{'kind': 'reading_note', 'id': row['id'], 'document_id': row['document_id'],
                            'title': '阅读笔记', 'owner_title': row['title'] or row['original_name'],
                            'version': row['version'], 'updated_at': row['updated_at'],
                            'excerpt': row['body_md'][:240],
                            'navigation': navigation('reading_note', row['id'], '阅读笔记', document_id=row['document_id'])}
                           for row in self.rows(f'SELECT n.id,n.document_id,n.version,n.updated_at,n.body_md,d.title,d.original_name FROM notes n JOIN documents d ON d.id=n.document_id WHERE n.document_id IN ({marks}) AND d.deleted_at IS NULL ORDER BY n.updated_at DESC,n.id LIMIT 20', tuple(docs))]
            from .relations import Relations
            relations = [item for item in Relations(self.library).topics(identity)['items'] if item['id'] in self.topic_ids]
            return {'kind': 'topic', 'id': identity, 'title': topic['title'], 'version': topic['version'],
                    'path': full_path, 'path_restricted': restricted,
                    'parent_id': topic['parent_id'] if topic['parent_id'] in allowed_topics else None,
                    'children': [{'kind': 'topic', 'id': row['id'], 'title': row['title'], 'version': row['version'],
                                  'navigation': navigation('topic', row['id'], row['title'])}
                                 for row in children[:50]],
                    'child_count': len(children),
                    'notes': notes[:20], 'note_count': len(notes),
                    'reading_notes': reading, 'reading_note_count': len(reading),
                    'materials': materials, 'material_count': len(docs),
                    'relations': [{'kind': 'topic', 'id': item['id'], 'title': item['title'],
                                   'version': item['version'], 'description': item['description'],
                                   'navigation': navigation('topic', item['id'], item['title'])} for item in relations[:20]],
                    'relation_count': len(relations),
                    'scope': {'version': topic['version'], 'selected': allowed[:100],
                              'selected_count': len(allowed), 'truncated': len(allowed) > 100,
                              'rules_count': len(visible_rules), 'restricted': hidden_scope or len(visible_rules) != len(rules)},
                    'navigation': navigation('topic', identity, topic['title'])}

    def inspect_proposals(self, proposal_id=None):
        if not self.session_id:
            return {'kind': 'proposal_status', 'state': 'no_session', 'items': [], 'proposal': None}
        from .collaboration import Collaboration
        service = Collaboration(self.library)
        with self.db.lock:
            task_ids = [row['id'] for row in self.rows('SELECT id FROM research_tasks WHERE session_id=?', (self.session_id,))]
            identities = []
            if task_ids:
                marks = ','.join('?' for _ in task_ids)
                identities = [row['id'] for row in self.rows(f"SELECT id,created_at FROM collaboration_proposals WHERE json_extract(origin_json,'$.task_id') IN ({marks}) ORDER BY created_at DESC,id DESC LIMIT 20", tuple(task_ids))]
        if proposal_id is not None:
            if proposal_id not in set(identities):
                raise ToolFault('OBJECT_NOT_FOUND', field='proposal_id', expected='a proposal from this session')
            item = self._proposal(service, proposal_id)
            summary = self._proposal_item(item)
            return {'kind': 'proposal_status', 'state': 'ok', 'items': [summary],
                    'proposal': {**summary,
                                 'origin': item['origin'],
                                 'operations': [{'key': op['key'], 'action': op['action'], 'title': op.get('title') or op.get('target_title') or '',
                                                 'object_id': op.get('object_id'), 'depends_on': op.get('depends_on', [])}
                                                for op in item['operations']],
                                 'selected': (item.get('decision') or {}).get('selected', []) if item.get('decision') else []}}
        return {'kind': 'proposal_status', 'state': 'ok',
                'items': [self._proposal_item(self._proposal(service, identity)) for identity in identities], 'proposal': None}

    @staticmethod
    def _proposal(service, identity):
        try: return service.get(identity)
        except HTTPException as error:
            if error.status_code == 404: raise ToolFault('OBJECT_NOT_FOUND', field='proposal_id', expected='a proposal from this session') from None
            raise ProbeError(str(error.detail)) from None

    @staticmethod
    def _proposal_item(item):
        return {'kind': 'proposal', 'id': item['id'], 'status': item['status'],
                'version': item['version'], 'stale': item['stale'], 'conflict': item['conflict'],
                'origin': item.get('origin'), 'dependencies': item.get('dependencies', []),
                'operation_count': len(item['operations']), 'created_at': item['created_at'],
                'updated_at': item['updated_at'],
                'navigation': navigation('proposal', item['id'], '修改方案')}

    def garden(self, parent_id=None, query='', page=1, page_size=PAGE_SIZE):
        """Page the actual visible topic tree, with note/material entry counts."""
        by = {row['id']: row for row in self.snapshot['topics']}
        if parent_id and parent_id not in by:
            raise ToolFault('OBJECT_NOT_FOUND', field='parent_id', expected='a visible topic ID')
        items = []
        for row in by.values():
            parts, seen, cursor = [], set(), row['id']
            while cursor in by and cursor not in seen:
                seen.add(cursor); parts.append(by[cursor]['title']); cursor = by[cursor]['parent_id']
            path = ' / '.join(reversed(parts))
            if query:
                if query.casefold() not in path.casefold(): continue
            elif (row['parent_id'] if row['parent_id'] in by else None) != parent_id: continue
            items.append({'kind':'topic','id':row['id'],'title':row['title'],'path':path,
                          'parent_id':row['parent_id'] if row['parent_id'] in by else None,
                          'version':row['version'],'child_count':sum(t['parent_id']==row['id'] for t in by.values()),
                          'navigation':navigation('topic',row['id'],row['title'])})
        items.sort(key=lambda item:(item['path'].casefold(),item['id']))
        start=(page-1)*page_size
        return {'kind':'garden','items':items[start:start+page_size],'total':len(items),
                'page':page,'has_more':start+page_size<len(items),
                'next_page':page+1 if start+page_size<len(items) else None}

    def outline_text(self):
        """Compact every-request outline: paths only, no IDs, no counts.

        Repeated on each turn, so it stays a few hundred bytes; the structured
        inspect_workspace result remains available when detail is needed.
        """
        by,folder_of,path=self.maps()
        folders,documents,_,_=self.visible(by,folder_of)
        names=sorted(path(identity) for identity in folders)
        topic_by={row['id']:row for row in self.snapshot['topics']}
        topics=[]
        for row in topic_by.values():
            parts,seen,cursor=[],set(),row['id']
            while cursor in topic_by and cursor not in seen:
                seen.add(cursor);parts.append(topic_by[cursor]['title'])
                cursor=topic_by[cursor]['parent_id']
            topics.append(' / '.join(reversed(parts)))
        topics.sort()
        def line(label,items,count):
            shown=items[:40]
            text=label+'（'+(('；'.join(shown)) or '无')+'）'
            if count>len(shown):text+=f' 等共 {count} 项，其余用工具分页读取'
            return text
        return (line('Storage 目录',names,len(folders))+'。'+
                line('Garden 专题',topics,len(topics))+'。'+
                f'另有 {len(documents)} 篇可见文献。目录与专题是不同对象；回答用名称即可，'
                '界面会展示服务器校验的详情卡片，正文证据用 search_local／read_local。')

    def outline(self):
        """Complete visible organization, capped and compact.

        The assistant starts every request with this outline, so it can answer
        "does this folder/topic exist" without guessing. Only names, paths and
        counts are included: IDs stay out so the outline fits the input budget,
        and tools resolve an ID when one is actually needed. Truncation is
        explicit; raw text stays behind search_local.
        """
        limit=40
        by,folder_of,path=self.maps()
        folders,documents,doc_count,_=self.visible(by,folder_of)
        folder_items=sorted(({'path':path(identity),'document_count':doc_count[identity]}
                             for identity in folders),
                            key=lambda item:(item['path'].casefold(),item['path']))
        topic_by={row['id']:row for row in self.snapshot['topics']}
        topic_items=[]
        for row in topic_by.values():
            parts,seen,cursor=[],set(),row['id']
            while cursor in topic_by and cursor not in seen:
                seen.add(cursor);parts.append(topic_by[cursor]['title'])
                cursor=topic_by[cursor]['parent_id']
            topic_items.append({'title':row['title'],'path':' / '.join(reversed(parts)),
                                'child_count':sum(item['parent_id']==row['id'] for item in topic_by.values())})
        topic_items.sort(key=lambda item:(item['path'].casefold(),item['title']))
        return {'kind':'workspace_outline','scope':self.scope['mode'],
                'folders':folder_items[:limit],'folder_count':len(folder_items),
                'folders_truncated':len(folder_items)>limit,
                'topics':topic_items[:limit],'topic_count':len(topic_items),
                'topics_truncated':len(topic_items)>limit,
                'document_count':len(documents),
                'note':'当前可见逻辑结构（不是论文证据）。folders 是 Storage 目录，topics 是 Garden 专题，两者不同；truncated=true 时用 browse_library／browse_garden 分页读取其余；回答用名称即可，界面会展示服务器校验的详情卡片；正文证据用 search_local／read_local。'}

    def reply_candidates(self):
        """Visible objects and the aliases a model may use to name them.

        Built once per session read; the model never supplies a URL, so every
        entry is resolved from the current snapshot and folder map.
        """
        candidates=[]
        by,folder_of,path=self.maps()
        visible,_,_,_=self.visible(by,folder_of)
        for identity in visible:
            row=by[identity]
            candidates.append({'kind':'folder','id':identity,'title':row['name'],
                               'path':path(identity),'aliases':[row['name']]})
        for row in self.snapshot['topics']:
            candidates.append({'kind':'topic','id':row['id'],'title':row['title'],
                               'aliases':[row['title']]})
        names={row['id']:row['title'] or row['original_name'] for row in self.snapshot['documents']}
        for row in self.snapshot['documents']:
            original=row['original_name']
            stem=original.rsplit('.',1)[0] if '.' in original else original
            candidates.append({'kind':'document','id':row['id'],'title':names[row['id']],
                               'aliases':[row['title'] or '',original,stem]})
        for row in self.snapshot['notebooks']:
            candidates.append({'kind':'topic_note','id':row['id'],'title':row['title'],
                               'aliases':[row['title']]})
        for row in self.snapshot['notes']:
            owner=names.get(row['document_id'])
            if not owner:continue
            candidates.append({'kind':'reading_note','id':row['id'],
                               'title':f'《{owner}》阅读笔记','document_id':row['document_id'],
                               'aliases':[f'《{owner}》阅读笔记']})
        return candidates

    def reply_references(self, refs, text, candidates=None, limit=8):
        """Show only objects the answer itself names, in the order it names them.

        Tool results supply candidates, never cards: browsing a folder or a
        search result list must not attach unrelated entries to the reply. An
        object becomes a card only when its title, original filename or note
        title appears in the answer body; objects the tools actually used tie
        first. Entries are server-built and always carry a navigation target.
        """
        wanted={(ref.get('kind'),ref.get('id')) for ref in refs}
        scored=[]
        for row in candidates if candidates is not None else self.reply_candidates():
            positions=[text.find(alias) for alias in row['aliases'] if len(alias)>=2]
            positions=[position for position in positions if position>=0]
            if not positions:continue
            scored.append((0 if (row['kind'],row['id']) in wanted else 1,min(positions),row))
        scored.sort(key=lambda entry:(entry[0],entry[1],entry[2]['title']))
        result=[]
        for _,_,row in scored[:limit]:
            item={key:value for key,value in row.items() if key!='aliases'}
            item['navigation']=navigation(row['kind'],row['id'],row['title'],
                                          document_id=row.get('document_id'))
            result.append(item)
        return result

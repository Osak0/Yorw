"""Document-level hints can nominate only current, scoped original evidence."""
import json
import re

from .search import tokens
from .search import fingerprint


def keyword_terms(query):
    # Preserve technical terms (including digits/abbreviations); do not remove
    # single Chinese characters from inside a scientific term.
    cleaned=re.sub(r'^(?:请问|请介绍|请说明|帮我|告诉我)\s*','',query.casefold())
    words=tokens(cleaned)
    return list(dict.fromkeys(w for w in words if w not in {'what','which','how','the','is','are','of','in','and','to','for'}))[:32]


def metadata_ranking(library, rows, query):
    """Never add an out-of-scope row or return generated metadata as evidence."""
    by_document={}
    for row in rows:
        if row['kind']=='document': by_document.setdefault(row['object_id'],[]).append(row)
    terms=keyword_terms(query)
    ranked=[]
    for identity, originals in by_document.items():
        doc=library.document(identity)
        hints=[doc['title'] or '',doc['original_name'],*doc['tags'],doc['summary_md'] or '']
        support=None
        enrichments=library.rows('SELECT * FROM document_enrichments WHERE document_id=? AND extraction_version=? ORDER BY id DESC LIMIT 1',(identity,doc['extraction_version']))
        if enrichments:
            item=enrichments[0]
            decisions={r['decision_key'] for r in library.rows('SELECT decision_key FROM enrichment_decisions WHERE document_id=? AND extraction_version=?',(identity,doc['extraction_version']))}
            if not item['hidden'] and 'hide' not in decisions:
                result=json.loads(item['result_json'])
                tags=[t for t in result.get('tags',[]) if 'tag:'+t.casefold() not in decisions]
                aliases=[t for t in result.get('synonyms',[]) if 'tag:'+t.casefold() not in decisions][:4]
                hints.extend(tags+aliases+[result.get(k,'') for k in ('overview','research_question','method','data','conclusion','limitations')])
                support=set(result.get('evidence_ids',[]))
        hint_tokens=set(tokens(' '.join(hints)))
        # One document-level FTS record, never a summary copied into each block.
        signature=fingerprint({'extraction_version':doc['extraction_version'],'tokens':sorted(hint_tokens)})
        with library.db.write() as conn:
            previous=conn.execute('SELECT fingerprint FROM document_hint_index WHERE document_id=?',(identity,)).fetchone()
            if not previous or previous[0]!=signature:
                conn.execute('DELETE FROM document_hint_index WHERE document_id=?',(identity,))
                conn.execute('INSERT INTO document_hint_index VALUES(?,?)',(identity,signature))
                conn.execute('INSERT INTO document_hint_fts VALUES(?,?)',(identity,' '.join(sorted(hint_tokens))))
        matches=[t for t in terms if t in hint_tokens]
        # Do not let a common single bigram expand a long unrelated Chinese query.
        if not terms or len(matches)/len(terms)<.6: continue
        eligible=[r for r in originals if not support or any(e.get('block_id') in support for e in r['source']['evidence'])]
        if not eligible: continue
        eligible.sort(key=lambda r:(-sum(t in r['text'].casefold() for t in terms),r['ordinal']))
        ranked.append((len(matches)/len(terms),len(matches),eligible[0]['id']))
    expression=' OR '.join('"'+t.replace('"','""')+'"' for t in terms)
    candidates=library.rows('SELECT document_id,bm25(document_hint_fts) AS score FROM document_hint_fts WHERE document_hint_fts MATCH ? ORDER BY score,document_id',(expression,)) if expression else []
    scoped_documents={r['document_id'] for r in candidates if r['document_id'] in by_document}
    eligible_ids={r['id'] for identity in scoped_documents for r in by_document[identity]}
    return [i for _,__,i in sorted(ranked,key=lambda v:(-v[0],-v[1],v[2])) if i in eligible_ids][:40]

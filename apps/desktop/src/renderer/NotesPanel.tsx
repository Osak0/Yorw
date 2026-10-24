import React, { useEffect, useState, useSyncExternalStore } from 'react'
import { MarkdownEditor } from './MarkdownEditor'
import { MarkdownPreview } from './MarkdownPreview'
import { dirty, notebookFor } from './notebook'

export function NotesPanel({ documentId }: {documentId: string}) {
  const notebook = notebookFor(documentId)
  const state = useSyncExternalStore(notebook.subscribe, notebook.getSnapshot)
  const [preview, setPreview] = useState(false)
  useEffect(() => { void notebook.load() }, [notebook])
  const note = state.notes.find(item => item.id === state.selected)
  return <div className="notes-panel"><p className="notes-intro">记录自己的理解；关联当前文献不代表内容已获原文证实。</p>
    <div className="notes-picker"><label>当前笔记<select aria-label="当前笔记" value={state.selected} disabled={!state.notes.length} onChange={event => notebook.select(event.target.value)}>{!state.notes.length && <option value="">暂无笔记</option>}{state.notes.map((item, index) => <option key={item.id} value={item.id}>{dirty(item) ? '● ' : ''}{item.body.split('\n').find(line => line.trim())?.replace(/^#+\s*/, '').slice(0, 28) || `笔记 ${index + 1}`}</option>)}</select></label><button disabled={!state.loaded} onClick={() => { notebook.create(); setPreview(false) }}>新建笔记</button></div>
    {state.loading && <p role="status">正在加载笔记…</p>}{state.error && <p role="alert">{state.error}<button onClick={() => void notebook.load()}>重试加载</button></p>}
    {state.loaded && !note && <p>点击“新建笔记”开始记录。保存后可在重启时继续编辑。</p>}
    {note?.sources?.length ? <details><summary>原始引用快照（编辑正文不会自动改变引用）</summary>{note.sources.map((source,i)=><p key={i}>[{source.citation ?? i+1}] · 物理页 {source.physical_page} · {source.available === false ? '来源已失效' : '待人工核查'}<br />{source.text}</p>)}</details> : null}
    {note && <><div className="note-toolbar"><div role="group" aria-label="笔记视图"><button aria-pressed={!preview} onClick={() => setPreview(false)}>编辑</button><button aria-pressed={preview} onClick={() => setPreview(true)}>预览</button></div><button className="save-note" disabled={note.saving || note.conflict || (note.version > 0 && !dirty(note))} onClick={() => void notebook.save(note.id)}>保存笔记</button></div>
      <p className="note-status" role="status">{note.saving ? '正在保存…' : dirty(note) ? `${note.message && note.message !== '已保存' ? note.message + ' ' : ''}有未保存更改（本次会话保留）` : note.message || (note.version ? '已保存' : '尚未保存')} · {note.body.length.toLocaleString()} / 200,000</p>
      <button disabled={note.saving} onClick={() => { if (window.confirm('放弃这条笔记的未保存更改？')) notebook.discard(note.id) }}>放弃更改</button><div hidden={preview} className="note-editor-view"><MarkdownEditor key={note.id} value={note.body} onChange={body => notebook.edit(note.id, body)} onSave={() => void notebook.save(note.id)} /></div>
      {preview && <MarkdownPreview body={note.body} />}
      {note.conflict && <div className="note-conflict"><button onClick={() => void notebook.compare(note.id)}>查看已保存版本</button>{note.remote && <><p>已保存版本 v{note.remote.version}（你的草稿仍在编辑区）</p><pre>{note.remote.body_md}</pre><button onClick={() => notebook.resolve(note.id, true)}>保留我的草稿，基于此版本继续</button><button onClick={() => { if (window.confirm('载入已保存内容将放弃这条笔记的当前草稿，是否继续？')) notebook.resolve(note.id, false) }}>放弃草稿，载入已保存内容</button></>}</div>}
    </>}
    <p className="notes-footnote">Ctrl+S 保存 · 草稿暂存于本次会话，关闭前请保存。预览不加载图片、HTML 或外部链接。</p>
  </div>
}

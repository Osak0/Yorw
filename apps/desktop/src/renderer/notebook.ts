import type { NoteRecord, NoteSource, NotesBridge } from '../shared/status'

export interface DraftNote {
  id: string; body: string; savedBody: string; version: number
  saving: boolean; message: string; conflict: boolean; remote?: NoteRecord; sources?: NoteSource[]
}
interface Snapshot { notes: DraftNote[]; selected: string; loaded: boolean; loading: boolean; error: string }
export const dirty = (note: DraftNote) => note.body !== note.savedBody
const explain = (code: string) => ({ NOTE_CONFLICT: '保存版本冲突，草稿已保留。请查看已保存版本并比较。', DOCUMENT_NOT_FOUND: '文献已移除，无法保存；当前草稿保留，可复制内容。', BACKEND_NOT_READY: '本地服务不可用，草稿已保留。请先复制重要内容。', INVALID_INPUT: '内容超出限制或格式无效，草稿已保留。' }[code] ?? '保存失败，草稿已保留，可以重试。')

/** Session-owned drafts survive component unmounts, navigation and backend failures. */
export class Notebook {
  private snapshot: Snapshot = { notes: [], selected: '', loaded: false, loading: false, error: '' }
  private listeners = new Set<() => void>()
  constructor(readonly documentId: string, private bridge: NotesBridge) {}
  getSnapshot = () => this.snapshot
  subscribe = (callback: () => void) => { this.listeners.add(callback); return () => { this.listeners.delete(callback) } }
  private publish(change: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...change }
    for (const callback of this.listeners) callback()
  }
  private patch(id: string, change: Partial<DraftNote>) {
    this.publish({ notes: this.snapshot.notes.map(note => note.id === id ? { ...note, ...change } : note) })
  }
  hasUnsaved() { return this.snapshot.notes.some(note => dirty(note) || note.saving) }
  async saveAll() {
    for (const note of this.snapshot.notes) {
      if ((dirty(note) || note.saving) && !note.conflict) await this.save(note.id)
    }
  }
  discardAll() {
    for (const note of this.snapshot.notes) if (dirty(note) && !note.saving) this.discard(note.id)
  }
  async importSaved(id: string) {
    await this.load()
    const result = await this.bridge.list(this.documentId)
    if (!result.ok) throw new Error('NOTE_LOAD_FAILED')
    const record = result.value.items.find(item => item.id === id)
    if (!record) throw new Error('NOTE_NOT_FOUND')
    if (!this.snapshot.notes.some(item => item.id === id)) this.publish({notes:[...this.snapshot.notes,{id,body:record.body_md,savedBody:record.body_md,sources:record.sources,version:record.version,saving:false,conflict:false,message:'已保存'}]})
    this.select(id)
  }
  async load() {
    if (this.snapshot.loaded || this.snapshot.loading) return
    this.publish({ loading: true, error: '' })
    try {
      const result = await this.bridge.list(this.documentId)
      if (!result.ok) { this.publish({ error: '笔记加载失败，请重试；不会以空白覆盖已保存内容。' }); return }
      const notes = result.value.items.map(note => ({ id: note.id, body: note.body_md, savedBody: note.body_md, sources: note.sources, version: note.version, saving: false, conflict: false, message: '' }))
      this.publish({ notes, selected: notes[0]?.id ?? '', loaded: true })
    } catch { this.publish({ error: '笔记加载失败，请重试。' }) }
    finally { this.publish({ loading: false }) }
  }
  create() {
    if (!this.snapshot.loaded) return
    const id = crypto.randomUUID()
    this.publish({ selected: id, notes: [...this.snapshot.notes, { id, body: '', savedBody: '', version: 0, saving: false, conflict: false, message: '' }] })
  }
  select(id: string) { if (this.snapshot.notes.some(note => note.id === id)) this.publish({ selected: id }) }
  edit(id: string, body: string) { this.patch(id, { body, message: '' }) }
  discard(id: string) {
    const note = this.snapshot.notes.find(item => item.id === id)
    if (!note || note.saving) return
    if (!note.version) {
      const notes = this.snapshot.notes.filter(item => item.id !== id)
      this.publish({ notes, selected: notes[0]?.id ?? '' })
    } else this.patch(id, { body: note.savedBody, message: '', conflict: false, remote: undefined })
  }
  async save(id: string) {
    const note = this.snapshot.notes.find(item => item.id === id)
    if (!note || note.saving || note.conflict) return
    if (note.body.length > 200_000) { this.patch(id, { message: '单条笔记上限 20 万字符，请缩短后保存；草稿保留。' }); return }
    // Capture the submitted body: edits typed while awaiting the response stay dirty.
    const submitted = note.body
    this.patch(id, { saving: true, message: '正在保存…' })
    try {
      const result = await this.bridge.save({ id, document_id: this.documentId, version: note.version, body_md: submitted })
      if (!result.ok) { this.patch(id, { message: explain(result.code), conflict: result.code === 'NOTE_CONFLICT' }); return }
      this.patch(id, { savedBody: result.value.body_md, version: result.value.version, remote: undefined, message: '已保存' })
    } catch { this.patch(id, { message: '保存失败，草稿已保留，可以重试。' }) }
    finally { this.patch(id, { saving: false }) }
  }
  async compare(id: string) {
    try {
      const result = await this.bridge.list(this.documentId)
      const remote = result.ok ? result.value.items.find(note => note.id === id) : undefined
      if (!remote) { this.patch(id, { message: '无法读取已保存版本；当前草稿保留。' }); return }
      this.patch(id, { remote, message: '已读取最新版本，请比较后选择。' })
    } catch { this.patch(id, { message: '读取失败；当前草稿保留。' }) }
  }
  resolve(id: string, keepDraft: boolean) {
    const note = this.snapshot.notes.find(item => item.id === id)
    if (!note?.remote) return
    this.patch(id, { body: keepDraft ? note.body : note.remote.body_md, savedBody: note.remote.body_md, version: note.remote.version, conflict: false, remote: undefined, message: keepDraft ? '保留了你的草稿，请核对后再次保存。' : '已载入保存内容。' })
  }
}

const notebooks = new Map<string, Notebook>()
export function notebookFor(documentId: string) {
  if (!notebooks.has(documentId)) notebooks.set(documentId, new Notebook(documentId, window.yorw.notes))
  return notebooks.get(documentId)!
}
export function hasUnsavedNotes() { return [...notebooks.values()].some(notebook => notebook.hasUnsaved()) }
export function documentHasUnsavedNotes(id: string) { return notebooks.get(id)?.hasUnsaved() ?? false }
export function unsavedDocumentIds() { return [...notebooks.values()].filter(notebook => notebook.hasUnsaved()).map(notebook => notebook.documentId) }

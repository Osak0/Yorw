import { expect, test, vi } from 'vitest'
import { Notebook, dirty } from '../src/renderer/notebook'
import type { NoteInput, NoteRecord, NotesBridge, Result } from '../src/shared/status'

const doc = '12345678-1234-1234-1234-123456789abc'
const record = (body = 'saved', version = 1): NoteRecord => ({ id: doc, document_id: doc, body_md: body, sources: [], version, created_at: '', updated_at: '', document_available: true })
function setup(items = [record()]) {
  const bridge: NotesBridge = { list: vi.fn(async () => ({ ok: true, value: { items } })), save: vi.fn(async (input: NoteInput) => ({ ok: true, value: record(input.body_md, input.version + 1) })) }
  return { bridge, notebook: new Notebook(doc, bridge) }
}

test('save acknowledgement never marks later edits saved; duplicate clicks are serialized', async () => {
  const { notebook, bridge } = setup()
  await notebook.load()
  notebook.edit(doc, 'submitted')
  let finish!: (result: Result<NoteRecord>) => void
  vi.mocked(bridge.save).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const saving = notebook.save(doc)
  await notebook.save(doc)
  expect(bridge.save).toHaveBeenCalledTimes(1)
  notebook.edit(doc, 'typed during save')
  finish({ ok: true, value: record('submitted', 2) })
  await saving
  const note = notebook.getSnapshot().notes[0]
  expect(note.body).toBe('typed during save')
  expect(note.savedBody).toBe('submitted')
  expect(note.version).toBe(2)
  expect(dirty(note)).toBe(true)
  expect(notebook.hasUnsaved()).toBe(true)
})

test('network failure and version conflict retain drafts until explicit comparison resolution', async () => {
  const { notebook, bridge } = setup()
  await notebook.load()
  notebook.edit(doc, 'my draft')
  vi.mocked(bridge.save).mockRejectedValueOnce(new Error('offline'))
  await notebook.save(doc)
  expect(notebook.getSnapshot().notes[0].body).toBe('my draft')
  expect(notebook.getSnapshot().notes[0].message).toContain('失败')
  vi.mocked(bridge.save).mockResolvedValueOnce({ ok: false, code: 'NOTE_CONFLICT' })
  await notebook.save(doc)
  await notebook.save(doc)
  expect(bridge.save).toHaveBeenCalledTimes(2)
  vi.mocked(bridge.list).mockResolvedValueOnce({ ok: true, value: { items: [record('new remote', 3)] } })
  await notebook.compare(doc)
  expect(notebook.getSnapshot().notes[0].body).toBe('my draft')
  notebook.resolve(doc, true)
  await notebook.save(doc)
  expect(bridge.save).toHaveBeenLastCalledWith({ id: doc, document_id: doc, version: 3, body_md: 'my draft' })
  expect(notebook.hasUnsaved()).toBe(false)
})

test('document notebooks and note selections keep independent drafts; load failure cannot create blank overwrites', async () => {
  const { notebook, bridge } = setup()
  const other = new Notebook('other-document', bridge)
  await notebook.load()
  await other.load()
  notebook.edit(doc, 'first document draft')
  expect(other.getSnapshot().notes[0].body).toBe('saved')
  notebook.create()
  const created = notebook.getSnapshot().selected
  notebook.edit(created, 'second note draft')
  notebook.select(doc)
  expect(notebook.getSnapshot().notes.find(note => note.id === created)?.body).toBe('second note draft')
  notebook.discard(created)
  expect(notebook.getSnapshot().notes).toHaveLength(1)
  expect(notebook.hasUnsaved()).toBe(true)
  const failed = setup([])
  vi.mocked(failed.bridge.list).mockRejectedValueOnce(new Error('offline'))
  await failed.notebook.load()
  failed.notebook.create()
  expect(failed.notebook.getSnapshot().notes).toHaveLength(0)
  expect(failed.notebook.getSnapshot().loaded).toBe(false)
  await failed.notebook.load()
  expect(failed.notebook.getSnapshot().loaded).toBe(true)
})

test('importing an answer note preserves existing dirty drafts and its evidence', async()=>{
 const {notebook,bridge}=setup()
 await notebook.load();notebook.edit(doc,'unsaved draft')
 const imported={...record('answer'),id:'new-answer',sources:[{citation:'S1',physical_page:1,text:'source'}]}
 vi.mocked(bridge.list).mockResolvedValue({ok:true,value:{items:[record(),imported]}})
 await notebook.importSaved('new-answer')
 expect(notebook.getSnapshot().notes[0].body).toBe('unsaved draft')
 expect(notebook.getSnapshot().selected).toBe('new-answer')
 expect(notebook.getSnapshot().notes[1].sources).toEqual(imported.sources)
})

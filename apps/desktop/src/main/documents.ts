import { dialog } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Backend } from './backend'

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value)) throw new Error('INVALID_INPUT')
  return value
}
export class Documents {
  constructor(private backend: Backend) {}
  readPdf(identity: unknown) { return this.backend.readPdf(id(identity)) }
  savePosition(input: any) {
    if (!input || !Number.isInteger(input.page) || input.page < 1) throw new Error('INVALID_PAGE')
    return this.backend.request(`/v1/documents/${id(input.id)}/position`, 'PATCH', { page: input.page })
  }
  list() { return this.backend.request('/v1/documents') }
  async importPdf() {
    const selected = await dialog.showOpenDialog({ title: '导入研究文献', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile'] })
    if (selected.canceled || !selected.filePaths[0]) return { cancelled: true }
    const path = selected.filePaths[0]
    if ((await stat(path)).size > 50 * 1024 * 1024) throw new Error('PDF_TOO_LARGE')
    const bytes = await readFile(path)
    if (bytes.length > 50 * 1024 * 1024) throw new Error('PDF_TOO_LARGE')
    const form = new FormData()
    form.append('file', new Blob([bytes]), basename(path))
    return this.backend.request('/v1/documents/import', 'POST', form)
  }
  update(input: any) {
    if (!input || !Number.isInteger(input.version) || !Array.isArray(input.authors)) throw new Error('INVALID_INPUT')
    if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 200 || input.tags.some((tag: unknown) => typeof tag !== 'string' || tag.length > 200))) throw new Error('INVALID_INPUT')
    if (input.summary_md !== undefined && input.summary_md !== null && (typeof input.summary_md !== 'string' || input.summary_md.length > 20_000)) throw new Error('INVALID_INPUT')
    return this.backend.request(`/v1/documents/${id(input.id)}`, 'PATCH', {
      title: input.title, authors: input.authors, year: input.year, version: input.version,
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.summary_md === undefined ? {} : { summary_md: input.summary_md })
    })
  }
  remove(input: any) {
    if (!input || !Number.isInteger(input.version) || input.version < 1) throw new Error('INVALID_INPUT')
    return this.backend.request(`/v1/documents/${id(input.id)}?version=${input.version}`, 'DELETE')
  }
  task(identity: unknown) { return this.backend.request(`/v1/tasks/${id(identity)}`) }
  cancel(identity: unknown) { return this.backend.request(`/v1/tasks/${id(identity)}/cancel`, 'POST', {}) }
  retry(identity: unknown) { return this.backend.request(`/v1/tasks/${id(identity)}/retry`, 'POST', {}) }
}

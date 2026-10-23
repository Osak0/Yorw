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
    return this.backend.request(`/v1/documents/${id(input.id)}`, 'PATCH', { title: input.title, authors: input.authors, year: input.year, version: input.version })
  }
  remove(input: any) {
    if (!input || !Number.isInteger(input.version) || input.version < 1) throw new Error('INVALID_INPUT')
    return this.backend.request(`/v1/documents/${id(input.id)}?version=${input.version}`, 'DELETE')
  }
  task(identity: unknown) { return this.backend.request(`/v1/tasks/${id(identity)}`) }
  cancel(identity: unknown) { return this.backend.request(`/v1/tasks/${id(identity)}/cancel`, 'POST', {}) }
  retry(identity: unknown) { return this.backend.request(`/v1/tasks/${id(identity)}/retry`, 'POST', {}) }
}

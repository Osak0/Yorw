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
  async importPdfs() {
    const selected = await dialog.showOpenDialog({ title: '批量导入研究文献', filters: [{ name: 'PDF', extensions: ['pdf'] }], properties: ['openFile', 'multiSelections'] })
    if (selected.canceled || !selected.filePaths.length) return { cancelled: true, items: [] }
    const items = []
    for (const path of selected.filePaths) {
      const name = basename(path)
      try {
        if ((await stat(path)).size > 50 * 1024 * 1024) throw new Error('PDF_TOO_LARGE')
        const bytes = await readFile(path)
        if (bytes.length > 50 * 1024 * 1024) throw new Error('PDF_TOO_LARGE')
        const form = new FormData()
        form.append('file', new Blob([bytes]), name)
        const result = await this.backend.request('/v1/documents/import', 'POST', form)
        items.push({ name, ok: true, document: result.document, task: result.task, deduplicated: Boolean(result.deduplicated) })
      } catch (error) {
        items.push({ name, ok: false, code: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'IMPORT_FAILED' })
      }
    }
    return { cancelled: false, items }
  }
  update(input: any) {
    if (!input || !Number.isInteger(input.version) || !input.id) throw new Error('INVALID_INPUT')
    if (input.title !== undefined && input.title !== null && typeof input.title !== 'string') throw new Error('INVALID_INPUT')
    if (input.authors !== undefined && !Array.isArray(input.authors)) throw new Error('INVALID_INPUT')
    if (input.year !== undefined && input.year !== null && !Number.isInteger(input.year)) throw new Error('INVALID_INPUT')
    if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > 200 || input.tags.some((tag: unknown) => typeof tag !== 'string' || tag.length > 200))) throw new Error('INVALID_INPUT')
    if (input.summary_md !== undefined && input.summary_md !== null && (typeof input.summary_md !== 'string' || input.summary_md.length > 20_000)) throw new Error('INVALID_INPUT')
    const payload: Record<string, unknown> = { version: input.version }
    for (const field of ['title', 'authors', 'year', 'tags', 'summary_md'] as const) {
      if (input[field] !== undefined) payload[field] = input[field]
    }
    return this.backend.request(`/v1/documents/${id(input.id)}`, 'PATCH', payload)
  }
  remove(input: any) {
    if (!input || !Number.isInteger(input.version) || input.version < 1) throw new Error('INVALID_INPUT')
    return this.backend.request(`/v1/documents/${id(input.id)}?version=${input.version}`, 'DELETE')
  }
  task(identity: unknown) { return this.backend.request(`/v1/tasks/${id(identity)}`) }
  cancel(identity: unknown) { return this.backend.request(`/v1/tasks/${id(identity)}/cancel`, 'POST', {}) }
  retry(identity: unknown) { return this.backend.request(`/v1/tasks/${id(identity)}/retry`, 'POST', {}) }
}

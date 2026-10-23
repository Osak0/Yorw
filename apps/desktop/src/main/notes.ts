import type { Backend } from './backend'
import type { NoteInput } from '../shared/status'

function identity(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error('INVALID_INPUT')
  return value
}

export class Notes {
  constructor(private backend: Backend) {}
  list(documentId: unknown) { return this.backend.request(`/v1/notes?document_id=${identity(documentId)}`) }
  save(input: NoteInput) {
    if (!input || typeof input.body_md !== 'string' || input.body_md.length > 200_000 || !Number.isSafeInteger(input.version) || input.version < 0) throw new Error('INVALID_INPUT')
    const id = identity(input.id)
    const documentId = identity(input.document_id)
    return input.version === 0
      ? this.backend.request('/v1/notes', 'POST', { id, document_id: documentId, body_md: input.body_md })
      : this.backend.request(`/v1/notes/${id}`, 'PATCH', { version: input.version, body_md: input.body_md })
  }
}

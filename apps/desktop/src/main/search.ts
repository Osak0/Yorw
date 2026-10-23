import type { Backend } from './backend'
import type { Providers } from './providers'

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error('INVALID_INPUT')
  return value
}
export class Search {
  constructor(private backend: Backend, private providers: Providers) {}
  status(identity: unknown) { return this.backend.request(`/v1/documents/${id(identity)}/index`) }
  cancel(identity: unknown) { return this.backend.request(`/v1/search/tasks/${id(identity)}/cancel`, 'POST', {}) }
  async index(input: {id: string; semantic: boolean; config_version: number}) {
    if (!input || typeof input.semantic !== 'boolean' || !Number.isSafeInteger(input.config_version) || input.config_version < 0) throw new Error('INVALID_INPUT')
    const identity = id(input.id)
    const credentials = input.semantic ? await this.providers.embeddingCredentials() : { key: '', version: 0 }
    if (input.semantic && credentials.version !== input.config_version) throw new Error('CONFIG_CHANGED')
    return this.backend.request(`/v1/documents/${identity}/index`, 'POST', { semantic: input.semantic, config_version: credentials.version }, credentials.key)
  }
  async query(input: {id: string; query: string; semantic: boolean; config_version: number; min_similarity?: number}) {
    if (!input || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 1000 || typeof input.semantic !== 'boolean' || !Number.isSafeInteger(input.config_version) || input.config_version < 0) throw new Error('INVALID_INPUT')
    const minimum = input.min_similarity ?? 0.5
    if (!Number.isFinite(minimum) || minimum < 0 || minimum > 1) throw new Error('INVALID_INPUT')
    const identity = id(input.id)
    const credentials = input.semantic ? await this.providers.embeddingCredentials() : { key: '', version: 0 }
    if (input.semantic && credentials.version !== input.config_version) throw new Error('CONFIG_CHANGED')
    return this.backend.request(`/v1/documents/${identity}/search`, 'POST', { query: input.query.trim(), semantic: input.semantic, config_version: credentials.version, min_similarity: minimum }, credentials.key)
  }
}

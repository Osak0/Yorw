import type { Backend } from './backend'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_DESCRIPTION = 500

function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('INVALID_INPUT')
  return value
}

function query(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) throw new Error('INVALID_INPUT')
  return encodeURIComponent(value)
}

function description(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_DESCRIPTION) throw new Error('INVALID_INPUT')
  return value
}

export class Resources {
  constructor(private backend: Backend) {}

  resource(value: unknown) { return this.backend.request(`/v1/documents/${id(value)}/resource`) }
  searchHistory(value: unknown) { return this.backend.request(`/v1/documents/${id(value)}/search-history`) }
  deleteSearchHistory(input: any) {
    return this.backend.request(`/v1/documents/${id(input?.document_id)}/search-history/${id(input?.history_id)}`, 'DELETE')
  }
  clearSearchHistory(value: unknown) { return this.backend.request(`/v1/documents/${id(value)}/search-history`, 'DELETE') }
  candidates(input: any) {
    return this.backend.request(`/v1/documents/${id(input?.id)}/related-candidates?query=${query(input?.query ?? '')}`)
  }
  searchDocuments(value: unknown) { return this.backend.request(`/v1/documents/search?query=${query(value ?? '')}`) }
  relations(value: unknown) { return this.backend.request(`/v1/documents/${id(value)}/relations`) }
  addRelation(input: any) {
    return this.backend.request(`/v1/documents/${id(input?.id)}/relations/${id(input?.related_id)}`, 'PUT', { description: description(input?.description ?? '') })
  }
  removeRelation(input: any) {
    return this.backend.request(`/v1/documents/${id(input?.id)}/relations/${id(input?.related_id)}`, 'DELETE')
  }
  documentTopics(value: unknown) { return this.backend.request(`/v1/documents/${id(value)}/topics`) }
  addDocumentTopic(input: any) {
    return this.backend.request(`/v1/documents/${id(input?.document_id)}/topics/${id(input?.topic_id)}`, 'PUT')
  }
  removeDocumentTopic(input: any) {
    return this.backend.request(`/v1/documents/${id(input?.document_id)}/topics/${id(input?.topic_id)}`, 'DELETE')
  }
  topicMaterials(value: unknown) { return this.backend.request(`/v1/topics/${id(value)}/materials`) }
  addTopicDocument(input: any) {
    return this.backend.request(`/v1/topics/${id(input?.topic_id)}/documents/${id(input?.document_id)}`, 'PUT')
  }
  removeTopicDocument(input: any) {
    return this.backend.request(`/v1/topics/${id(input?.topic_id)}/documents/${id(input?.document_id)}`, 'DELETE')
  }
}

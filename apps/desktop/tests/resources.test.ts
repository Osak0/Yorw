import { expect, test, vi } from 'vitest'
import { Resources } from '../src/main/resources'
import type { Backend } from '../src/main/backend'

const first = '12345678-1234-1234-1234-123456789abc'
const second = '87654321-4321-4321-4321-cba987654321'

test('resource bridge validates IDs and forwards fixed stage B routes', async () => {
  const request = vi.fn(async () => ({}))
  const resources = new Resources({ request } as unknown as Backend)
  expect(() => resources.resource('../outside')).toThrow('INVALID_INPUT')
  expect(() => resources.addRelation({ id: first, related_id: '../outside', description: '' })).toThrow('INVALID_INPUT')
  expect(() => resources.addRelation({ id: first, related_id: second, description: 'x'.repeat(501) })).toThrow('INVALID_INPUT')

  await resources.resource(first)
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/resource`)
  await resources.searchHistory(first)
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/search-history`)
  await resources.deleteSearchHistory({ document_id: first, history_id: second })
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/search-history/${second}`, 'DELETE')
  await resources.clearSearchHistory(first)
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/search-history`, 'DELETE')
  await resources.candidates({ id: first, query: 'graph neural' })
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/related-candidates?query=graph%20neural`)
  await resources.searchDocuments('检索 增强')
  expect(request).toHaveBeenLastCalledWith('/v1/documents/search?query=%E6%A3%80%E7%B4%A2%20%E5%A2%9E%E5%BC%BA')
  await resources.relations(first)
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/relations`)
  await resources.addRelation({ id: first, related_id: second, description: '共同主题' })
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/relations/${second}`, 'PUT', { description: '共同主题' })
  await resources.removeRelation({ id: first, related_id: second })
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/relations/${second}`, 'DELETE')
  await resources.documentTopics(first)
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/topics`)
  await resources.addDocumentTopic({ document_id: first, topic_id: second })
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/topics/${second}`, 'PUT')
  await resources.removeDocumentTopic({ document_id: first, topic_id: second })
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${first}/topics/${second}`, 'DELETE')
  await resources.topicMaterials(first)
  expect(request).toHaveBeenLastCalledWith(`/v1/topics/${first}/materials`)
  await resources.addTopicDocument({ topic_id: first, document_id: second })
  expect(request).toHaveBeenLastCalledWith(`/v1/topics/${first}/documents/${second}`, 'PUT')
  await resources.removeTopicDocument({ topic_id: first, document_id: second })
  expect(request).toHaveBeenLastCalledWith(`/v1/topics/${first}/documents/${second}`, 'DELETE')
})

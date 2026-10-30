import { expect, test } from 'vitest'
import type { Topic } from '../src/shared/status'
import { collectAncestors, defaultExpanded, parentOptions, searchTopics, topicChildren, topicDescendants, topicLocationLabel, topicPath, topicPathLabel } from '../src/renderer/garden-tree'

const topic = (id: string, title: string, parent_id: string | null = null): Topic => ({
  id, title, parent_id, current_revision_id: '', version: 1, created_at: '', updated_at: ''
})
const topics = [
  topic('a', 'Methods'),
  topic('b', 'Imaging', 'a'),
  topic('c', 'Lung', 'b'),
  topic('d', 'Results'),
  topic('e', 'Methods', 'd')
]

test('paths, children and descendants preserve the hierarchy', () => {
  expect(topicPath(topics, 'c').map(item => item.id)).toEqual(['a', 'b', 'c'])
  expect(topicPathLabel(topics, 'c')).toBe('Methods / Imaging / Lung')
  expect(topicChildren(topics, 'a').map(item => item.id)).toEqual(['b'])
  expect([...topicDescendants(topics, 'a')].sort()).toEqual(['a', 'b', 'c'])
  expect(defaultExpanded(topics).sort()).toEqual(['a', 'b', 'd'])
  expect([...collectAncestors(topics, 'c')].sort()).toEqual(['a', 'b'])
})

test('search keeps ancestors, matches duplicate names and returns the whole tree when empty', () => {
  const lung = searchTopics(topics, 'lung')
  expect([...lung.matches]).toEqual(['c'])
  expect([...lung.visible].sort()).toEqual(['a', 'b', 'c'])
  expect([...lung.ancestors].sort()).toEqual(['a', 'b'])
  const methods = searchTopics(topics, 'METHODS')
  expect([...methods.matches].sort()).toEqual(['a', 'e'])
  expect([...methods.visible].sort()).toEqual(['a', 'd', 'e'])
  expect([...searchTopics(topics, '').visible].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
})

test('location labels show ancestors under the root without repeating the topic', () => {
  expect(topicLocationLabel(topics, 'a')).toBe('根目录')
  expect(topicLocationLabel(topics, 'b')).toBe('根目录 › Methods')
  expect(topicLocationLabel(topics, 'c')).toBe('根目录 › Methods › Imaging')
  expect(topicLocationLabel(topics, 'missing')).toBe('根目录')
})

test('parent options exclude the topic and its descendants and use full paths', () => {
  const options = parentOptions(topics, 'a')
  expect(options.map(item => item.id).sort()).toEqual(['d', 'e'])
  expect(options.map(item => item.label)).toEqual(['Results', 'Results / Methods'])
  expect(parentOptions(topics).map(item => item.label)).toEqual([
    'Methods', 'Methods / Imaging', 'Methods / Imaging / Lung', 'Results', 'Results / Methods'
  ])
})

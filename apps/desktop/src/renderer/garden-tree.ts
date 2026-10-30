import type { Topic } from '../shared/status'

export interface TopicSearch {
  visible: Set<string>
  matches: Set<string>
  ancestors: Set<string>
}

export interface ParentOption {
  id: string
  title: string
  path: string
  label: string
}

export function topicChildren(topics: Topic[], parentId: string | null): Topic[] {
  return topics.filter(topic => topic.parent_id === parentId)
}

export function topicPath(topics: Topic[], id: string): Topic[] {
  const byId = new Map(topics.map(topic => [topic.id, topic]))
  const chain: Topic[] = []
  const seen = new Set<string>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    chain.unshift(current)
    current = current.parent_id ? byId.get(current.parent_id) : undefined
  }
  return chain
}

export function topicPathLabel(topics: Topic[], id: string): string {
  const path = topicPath(topics, id).map(topic => topic.title)
  return path.length ? path.join(' / ') : '根目录'
}

export function collectAncestors(topics: Topic[], id: string): Set<string> {
  return new Set(topicPath(topics, id).slice(0, -1).map(topic => topic.id))
}

export function topicDescendants(topics: Topic[], id: string): Set<string> {
  const result = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const topic of topics) {
      if (topic.parent_id && result.has(topic.parent_id) && !result.has(topic.id)) {
        result.add(topic.id)
        changed = true
      }
    }
  }
  return result
}

export function defaultExpanded(topics: Topic[]): string[] {
  const parents = new Set(topics.map(topic => topic.parent_id).filter((id): id is string => !!id))
  return topics.filter(topic => parents.has(topic.id)).map(topic => topic.id)
}

export function searchTopics(topics: Topic[], query: string): TopicSearch {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return { visible: new Set(topics.map(topic => topic.id)), matches: new Set(), ancestors: new Set() }
  const matches = new Set(topics.filter(topic => topic.title.toLocaleLowerCase().includes(needle)).map(topic => topic.id))
  const ancestors = new Set<string>()
  for (const id of matches) {
    for (const parent of collectAncestors(topics, id)) ancestors.add(parent)
  }
  return { visible: new Set([...matches, ...ancestors]), matches, ancestors }
}

export function parentOptions(topics: Topic[], excludeId?: string): ParentOption[] {
  const excluded = excludeId ? topicDescendants(topics, excludeId) : new Set<string>()
  return topics
    .filter(topic => !excluded.has(topic.id))
    .map(topic => ({ id: topic.id, title: topic.title, path: topicPathLabel(topics, topic.id), label: topicPathLabel(topics, topic.id) }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN'))
}

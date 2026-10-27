import { useSyncExternalStore } from 'react'

export type SidebarMode = 'notes' | 'search' | 'chat'

export interface SidebarPreference {
  mode: SidebarMode
  width: number
}

export interface DocumentSession {
  page: number | null
  zoom: number | 'fit'
  sidebarMode: SidebarMode
  sidebarOpen: boolean | null
  sidebarWidth: number
  searchQuery: string
  chatQuestion: string
}

export interface TopicSession {
  aiInstruction: string
}

class SessionStore {
  private documents = new Map<string, DocumentSession>()
  private topics = new Map<string, TopicSession>()
  private listeners = new Set<() => void>()
  private sidebarPreference: SidebarPreference = { mode: 'notes', width: 380 }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  document(id: string): DocumentSession {
    let session = this.documents.get(id)
    if (!session) {
      session = {
        page: null,
        zoom: 'fit',
        sidebarMode: this.sidebarPreference.mode,
        sidebarOpen: null,
        sidebarWidth: this.sidebarPreference.width,
        searchQuery: '',
        chatQuestion: ''
      }
      this.documents.set(id, session)
    }
    return session
  }

  topic(id: string): TopicSession {
    let session = this.topics.get(id)
    if (!session) {
      session = { aiInstruction: '' }
      this.topics.set(id, session)
    }
    return session
  }

  updateDocument(id: string, patch: Partial<DocumentSession>) {
    const current = this.document(id)
    const keys = Object.keys(patch) as (keyof DocumentSession)[]
    if (keys.every(key => current[key] === patch[key])) return
    const next = { ...current, ...patch }
    this.documents.set(id, next)
    if (patch.sidebarMode) this.sidebarPreference = { ...this.sidebarPreference, mode: patch.sidebarMode }
    if (patch.sidebarWidth) this.sidebarPreference = { ...this.sidebarPreference, width: patch.sidebarWidth }
    this.publish()
  }

  updateTopic(id: string, patch: Partial<TopicSession>) {
    const current = this.topic(id)
    const keys = Object.keys(patch) as (keyof TopicSession)[]
    if (keys.every(key => current[key] === patch[key])) return
    this.topics.set(id, { ...current, ...patch })
    this.publish()
  }

  applySidebarPreference(preference: SidebarPreference) {
    this.sidebarPreference = { ...preference }
  }

  sidebarPreferenceFor(documentId: string | null): SidebarPreference {
    const session = documentId ? this.documents.get(documentId) : undefined
    return session ? { mode: session.sidebarMode, width: session.sidebarWidth } : { ...this.sidebarPreference }
  }

  private publish() {
    for (const listener of this.listeners) listener()
  }
}

let store: SessionStore | undefined

export function sessionStore() {
  return store ??= new SessionStore()
}

export function useDocumentSession(id: string) {
  const current = sessionStore()
  return useSyncExternalStore(current.subscribe, () => current.document(id), () => current.document(id))
}

export function useTopicSession(id: string) {
  const current = sessionStore()
  return useSyncExternalStore(current.subscribe, () => current.topic(id), () => current.topic(id))
}

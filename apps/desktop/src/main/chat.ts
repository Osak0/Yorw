import type { Backend } from './backend'
import type { Providers } from './providers'
import type { ChatInput } from '../shared/status'
const id = (value: unknown): string => { if(typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new Error('INVALID_INPUT');return value }
export class Chat {
  constructor(private backend: Backend, private providers: Providers) {}
  list(value: unknown) { return this.backend.request(`/v1/documents/${id(value)}/chat`) }
  cancel(value: unknown) { return this.backend.request(`/v1/chat/${id(value)}/cancel`,'POST',{}) }
  note(value: unknown) { return this.backend.request(`/v1/chat/${id(value)}/note`,'POST',{}) }
  async ask(input: ChatInput) {
    if(!input || typeof input.question !== 'string' || !input.question.trim() || input.question.length>4000 || !Array.isArray(input.segment_ids) || !input.segment_ids.length || input.segment_ids.length>8 || !Number.isSafeInteger(input.config_version)) throw new Error('INVALID_INPUT')
    const identity=id(input.document_id), segments=input.segment_ids.map(id)
    const credentials=await this.providers.chatCredentials()
    if(!credentials.version) throw new Error('CONFIG_MISSING')
    if(credentials.version!==input.config_version) throw new Error('CONFIG_CHANGED')
    return this.backend.request(`/v1/documents/${identity}/chat`,'POST',{question:input.question.trim(),segment_ids:segments,config_version:credentials.version},credentials.key)
  }
}

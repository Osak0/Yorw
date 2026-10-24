export interface Topic { id:string; parent_id:string|null; title:string; current_revision_id:string; version:number; created_at:string; updated_at:string }
export interface Revision { id:string; topic_id:string; ordinal:number; body_md:string; sources:unknown[]; origin:string; base_revision_id:string|null; restored_from_id:string|null; created_at:string }
export interface TopicView { topic:Topic; revision:Revision }
export interface TopicFields {title:string;parent_id:string|null}
export interface GardenBridge {
 list():Promise<Result<{items:Topic[]}>>; get(id:string):Promise<Result<TopicView>>;
 create(input:TopicFields & {id:string}):Promise<Result<TopicView>>;
 update(input:TopicFields & {id:string;version:number}):Promise<Result<TopicView>>;
 save(input:{id:string;base_revision_id:string;body_md:string}):Promise<Result<TopicView>>;
 history(id:string):Promise<Result<{items:Revision[]}>>
}
export interface ChatSource { id: string; chunk_id: string; document_id: string; text: string; physical_page: number; extraction_version: number; available: boolean }
export interface ChatMessage { id: string; document_id: string; question: string; body_md: string; status: string; error_code: string | null; sources: ChatSource[]; citations: number[]; note_id: string | null; provider: {model: string; base_url: string; version: number} }
export interface ChatInput { document_id: string; question: string; segment_ids: string[]; config_version: number }
export interface ChatBridge { list(id: string): Promise<Result<{items: ChatMessage[]}>>; ask(input: ChatInput): Promise<Result<ChatMessage>>; cancel(id: string): Promise<Result<ChatMessage>>; note(id: string): Promise<Result<{id: string}>> }
export interface AppStatus { state: 'starting' | 'ready' | 'failed'; message: string; code?: string }
export interface Evidence { segment_id: string; chunk_id: string; document_id: string; document_title: string; physical_page: number; text: string; extraction_version: number; chunk_version: string; start_offset: number; end_offset: number; methods: string[]; score: number; similarity: number | null }
export interface SearchResult { min_similarity: number; best_similarity: number | null; query: string; items: Evidence[]; mode: 'keyword' | 'hybrid'; reason: string | null; extraction_status: string; chunk_version: string }
export interface IndexStatus { keyword_ready: boolean; semantic_ready: boolean; segments: number; dimension: number | null; chunk_version: string; extraction_version: number; config: ProviderConfig | null; task: TaskRecord | null }
export interface SearchBridge { status(id: string): Promise<Result<IndexStatus>>; index(input: {id: string; semantic: boolean; config_version: number}): Promise<Result<TaskRecord>>; query(input: {id: string; query: string; semantic: boolean; config_version: number; min_similarity?: number}): Promise<Result<SearchResult>>; cancel(id: string): Promise<Result<TaskRecord>> }
export interface NoteSource { citation?: string; physical_page?: number; text?: string; available?: boolean }
export interface NoteRecord { id: string; document_id: string; body_md: string; sources: NoteSource[]; version: number; created_at: string; updated_at: string; document_available: boolean }
export interface NoteInput { id: string; document_id: string; body_md: string; version: number }
export interface NotesBridge { list(documentId: string): Promise<Result<{items: NoteRecord[]}>>; save(input: NoteInput): Promise<Result<NoteRecord>> }
export interface DesktopBridge { garden: GardenBridge; chat: ChatBridge; search: SearchBridge; notes: NotesBridge; getStatus(): Promise<AppStatus>; documents: { readPdf(id: string): Promise<Result<Uint8Array>>; savePosition(input: {id: string; page: number}): Promise<Result<{page: number}>>; list(): Promise<Result<{items: DocumentRecord[]}>>; importPdf(): Promise<Result<ImportResult>>; update(input: DocumentInput): Promise<Result<DocumentRecord>>; remove(input: {id: string; version: number}): Promise<Result<{removed: boolean; cleanup_pending: boolean}>> }; tasks: { cancel(id: string): Promise<Result<TaskRecord>>; get(id: string): Promise<Result<TaskRecord>>; retry(id: string): Promise<Result<TaskRecord>> }; providers: { list(): Promise<Result<ProviderConfig[]>>; save(input: ProviderInput): Promise<Result<ProviderConfig>>; test(kind: ProviderKind): Promise<Result<ProbeResult>> } }

export type ProviderKind = 'chat' | 'embedding'
export interface ProviderConfig { kind: ProviderKind; base_url: string; model: string; version: number; has_key?: boolean; key_error?: boolean }
export interface ProviderInput extends ProviderConfig { key?: string; clear_key?: boolean }
export interface ProbeResult { ok: boolean; code: string; dimension?: number }
export type Result<T> = { ok: true; value: T } | { ok: false; code: string }

export interface DocumentRecord { id: string; original_name: string; title: string | null; authors: string[]; year: number | null; version: number; page_count: number | null; last_page: number; extraction_status: string; warning: string | null; metadata_source: Record<string, string>; task?: TaskRecord }
export interface TaskRecord { id: string; target_id: string; status: string; stage: string; progress: number | null }
export interface DocumentInput { id: string; version: number; title: string | null; authors: string[]; year: number | null }
export interface ImportResult { cancelled?: boolean; document?: DocumentRecord; task?: TaskRecord; deduplicated?: boolean }

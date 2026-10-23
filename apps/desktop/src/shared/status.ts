export interface AppStatus { state: 'starting' | 'ready' | 'failed'; message: string; code?: string }
export interface NoteRecord { id: string; document_id: string; body_md: string; sources: unknown[]; version: number; created_at: string; updated_at: string; document_available: boolean }
export interface NoteInput { id: string; document_id: string; body_md: string; version: number }
export interface NotesBridge { list(documentId: string): Promise<Result<{items: NoteRecord[]}>>; save(input: NoteInput): Promise<Result<NoteRecord>> }
export interface DesktopBridge { notes: NotesBridge; getStatus(): Promise<AppStatus>; documents: { readPdf(id: string): Promise<Result<Uint8Array>>; savePosition(input: {id: string; page: number}): Promise<Result<{page: number}>>; list(): Promise<Result<{items: DocumentRecord[]}>>; importPdf(): Promise<Result<ImportResult>>; update(input: DocumentInput): Promise<Result<DocumentRecord>>; remove(input: {id: string; version: number}): Promise<Result<{removed: boolean; cleanup_pending: boolean}>> }; tasks: { cancel(id: string): Promise<Result<TaskRecord>>; get(id: string): Promise<Result<TaskRecord>>; retry(id: string): Promise<Result<TaskRecord>> }; providers: { list(): Promise<Result<ProviderConfig[]>>; save(input: ProviderInput): Promise<Result<ProviderConfig>>; test(kind: ProviderKind): Promise<Result<ProbeResult>> } }

export type ProviderKind = 'chat' | 'embedding'
export interface ProviderConfig { kind: ProviderKind; base_url: string; model: string; version: number; has_key?: boolean; key_error?: boolean }
export interface ProviderInput extends ProviderConfig { key?: string; clear_key?: boolean }
export interface ProbeResult { ok: boolean; code: string; dimension?: number }
export type Result<T> = { ok: true; value: T } | { ok: false; code: string }

export interface DocumentRecord { id: string; original_name: string; title: string | null; authors: string[]; year: number | null; version: number; page_count: number | null; last_page: number; extraction_status: string; warning: string | null; metadata_source: Record<string, string>; task?: TaskRecord }
export interface TaskRecord { id: string; target_id: string; status: string; stage: string; progress: number | null }
export interface DocumentInput { id: string; version: number; title: string | null; authors: string[]; year: number | null }
export interface ImportResult { cancelled?: boolean; document?: DocumentRecord; task?: TaskRecord; deduplicated?: boolean }

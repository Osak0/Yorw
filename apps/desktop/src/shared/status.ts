export interface MaterialChoice {kind:'settings'|'document'|'note'|'message';id:string;version:string;label:string}
export interface MaterialInput {kind:'settings'|'document'|'note'|'message';id:string;version:string;segment_ids:string[]}
export interface SourceRef {source_id:string;title?:string;kind:'document'|'note'|'message'|'wiki';source_object_id:string;source_version:string;excerpt:string;available?:boolean;evidence:{document_id:string;document_title:string;chunk_id?:string|null;physical_page:number|null;block_id?:string|null;block_type?:string|null;section_path?:string[];quote:string;extraction_version:number}[]}
export interface MaterialPreview {base_revision_id:string;base_body_md:string;title:string;sources:SourceRef[]}
export type AiScope = 'topic' | 'workspace'
export interface SuggestionScope {mode:AiScope;topic_id?:string;document_ids?:string[];note_ids?:string[];wiki_topic_ids?:string[];fingerprint?:string}
export interface Suggestion {id:string;topic_id:string;base_revision_id:string;base_body_md:string;instruction:string;body_md:string;sources:SourceRef[];decision?:{action:'accept'|'reject';revision_id:string|null}|null;status:string;error_code:string|null;recoverable?:boolean;stale:boolean;scope:SuggestionScope;scope_changed:boolean;citations:number[];task_id:string;provider:{model:string;base_url:string;version:number};created_at:string}
export interface WikiDecisionInput {request_id:string;base_revision_id:string}
export interface WikiDecisionResult {view:TopicView;decision:{request_id:string;action:string;revision_id:string|null;suggestion_id:string|null}}
export interface ExportCatalog {notes:{id:string;label:string;document_title:string;document_available:boolean;version:number}[];topics:Topic[]}
export interface WorkspaceBridge {info():Promise<Result<{workspace_id:string;schema_version:number;data_location:string}>>;catalog():Promise<Result<ExportCatalog>>;create(input:{note_ids:string[];topic_ids:string[]}):Promise<Result<{task_id:string;count:number;bytes:number}>>;save(taskId:string):Promise<Result<{cancelled?:boolean;saved?:boolean}>>}
export interface SuggestionInput {topic_id:string;base_revision_id:string;instruction:string;materials:MaterialInput[]}
export interface SuggestionsBridge {catalog():Promise<Result<{items:MaterialChoice[]}>>;preview(input:SuggestionInput):Promise<Result<MaterialPreview>>;generate(input:SuggestionInput&{request_id:string;config_version:number}):Promise<Result<Suggestion>>;list(id:string):Promise<Result<{items:Suggestion[]}>>;cancel(id:string):Promise<Result<Suggestion>>}
export interface Topic { id:string; parent_id:string|null; title:string; current_revision_id:string; version:number; created_at:string; updated_at:string }
export interface Revision { id:string; topic_id:string; ordinal:number; body_md:string; sources:unknown[]; origin:string; base_revision_id:string|null; restored_from_id:string|null; created_at:string }
export interface TopicView { topic:Topic; revision:Revision }
export interface TopicFields {title:string;parent_id:string|null}
export interface GardenBridge {
 list():Promise<Result<{items:Topic[]}>>; get(id:string):Promise<Result<TopicView>>;
 create(input:TopicFields & {id:string}):Promise<Result<TopicView>>;
 update(input:TopicFields & {id:string;version:number}):Promise<Result<TopicView>>;
 save(input:{id:string;base_revision_id:string;body_md:string}):Promise<Result<TopicView>>;
 history(id:string):Promise<Result<{items:Revision[]}>>;
 accept(input:WikiDecisionInput&{id:string;body_md:string;apply_mode?:'append'|'replace'}):Promise<Result<WikiDecisionResult>>;
 reject(input:WikiDecisionInput&{id:string}):Promise<Result<WikiDecisionResult>>;
 restore(input:WikiDecisionInput&{id:string;revision_id:string}):Promise<Result<WikiDecisionResult>>
}
export interface ChatSource { id: string; chunk_id?: string | null; document_id: string; text: string; physical_page: number | null; extraction_version: number; available: boolean; block_id?: string | null; block_type?: string | null; section_path?: string[] }
export interface ChatMessage { id: string; document_id: string; question: string; body_md: string; status: string; error_code: string | null; sources: ChatSource[]; citations: number[]; note_id: string | null; provider: {model: string; base_url: string; version: number} }
export interface ChatInput { document_id: string; question: string; segment_ids: string[]; config_version: number }
export interface ChatBridge { list(id: string): Promise<Result<{items: ChatMessage[]}>>; ask(input: ChatInput): Promise<Result<ChatMessage>>; cancel(id: string): Promise<Result<ChatMessage>>; note(id: string): Promise<Result<{id: string}>> }
export interface AppStatus { state: 'starting' | 'ready' | 'failed'; message: string; code?: string }
export interface Evidence { segment_id: string; chunk_id: string; document_id: string; document_title: string; physical_page: number; text: string; extraction_version: number; chunk_version: string; start_offset: number; end_offset: number; methods: string[]; score: number; similarity: number | null }export interface SearchResult { min_similarity: number; best_similarity: number | null; query: string; items: Evidence[]; mode: 'keyword' | 'hybrid'; reason: string | null; extraction_status: string; chunk_version: string }
export interface IndexStatus { keyword_ready: boolean; semantic_ready: boolean; segments: number; dimension: number | null; chunk_version: string; extraction_version: number; config: ProviderConfig | null; task: TaskRecord | null }
export interface SearchBridge { status(id: string): Promise<Result<IndexStatus>>; index(input: {id: string; semantic: boolean; config_version: number}): Promise<Result<TaskRecord>>; query(input: {id: string; query: string; semantic: boolean; config_version: number; min_similarity?: number}): Promise<Result<SearchResult>>; cancel(id: string): Promise<Result<TaskRecord>> }
export interface NoteSource { block_id?:string; extraction_version?:number; citation?: string; physical_page?: number; text?: string; available?: boolean }
export interface NoteRecord { id: string; document_id: string; body_md: string; sources: NoteSource[]; version: number; created_at: string; updated_at: string; document_available: boolean }
export interface NoteInput { id: string; document_id: string; body_md: string; version: number }
export interface NotesBridge { list(documentId: string): Promise<Result<{items: NoteRecord[]}>>; save(input: NoteInput): Promise<Result<NoteRecord>> }
export type WorkspaceLayoutModule = 'Storage' | 'Garden' | 'House'
export type WorkspaceLayoutSidebarMode = 'notes' | 'search' | 'chat'
export interface WorkspaceLayoutTab {kind:'settings'|'document'|'topic'|'notes'|'search'|'chat'|'resource'|'metadata'|'ai'|'history'|'materials';id:string;title?:string}
export interface WorkspaceLayout {version:1;module:WorkspaceLayoutModule;tabs:WorkspaceLayoutTab[];activeKey:string|null;storageKey:string|null;gardenKey:string|null;sidebar?:{mode:WorkspaceLayoutSidebarMode;width:number};directoryCollapsed?:boolean;storageDirectoryCollapsed?:boolean}
export interface LayoutBridge {load():Promise<Result<{layout:WorkspaceLayout|null;invalid?:boolean}>>;save(layout:WorkspaceLayout):Promise<Result<{saved:boolean}>>}
export interface DocumentSummary { id:string; original_name:string; title:string|null; authors:string[]; year:number|null; tags:string[]; document_available:boolean }
export interface ResourceTopic { topic:Topic; path:string[] }
export interface RelatedDocument { document:DocumentSummary; document_available:boolean; description:string; created_at:string; updated_at:string }
export interface TagMatch { document:DocumentSummary; shared_tags:string[] }
export interface ResourceNote { id:string; document_id:string; excerpt:string; version:number; created_at:string; updated_at:string; sources_count:number }
export interface ResourceChat { id:string; question:string; body_excerpt:string; status:string; error_code:string|null; created_at:string; sources_count:number; citations:number }
export interface SearchHistoryEvidence { document_id:string; chunk_id?:string|null; physical_page:number|null; extraction_version:number; quote:string; available:boolean; block_id?:string|null; block_type?:string|null; section_path?:string[] }
export interface SearchHistoryItem { id:string; kind:string; object_id:string; title:string; snippet:string; snippet_start:number; snippet_end:number; document_id:string|null; physical_page:number|null; block_id?:string|null; block_type?:string|null; section_path?:string[]; evidence:SearchHistoryEvidence[]; available:boolean }
export interface SearchHistoryEntry { id:string; document_id:string; request_id:string; task_id:string; query:string; status:string; error_code:string|null; reason:string|null; created_at:string; updated_at:string; result_count:number; items:SearchHistoryItem[] }
export interface DocumentResource { document:DocumentRecord; topics:ResourceTopic[]; related:RelatedDocument[]; tag_matches:TagMatch[]; notes:ResourceNote[]; chat:ResourceChat[]; search_history:SearchHistoryEntry[] }
export interface TopicMaterialDocument { document:DocumentSummary; linked_at?:string; topics?:{id:string;title:string}[] }
export interface TopicMaterialNote { id:string; document_id:string; document_title:string; document_available:boolean; direct:boolean; topics:string[]; excerpt:string; version:number; sources_count:number; created_at:string; updated_at:string }
export interface TopicMaterials { topic:Topic; direct:TopicMaterialDocument[]; inherited:TopicMaterialDocument[]; notes:TopicMaterialNote[] }
export interface ResourcesBridge {
  resource(id:string):Promise<Result<DocumentResource>>;
  searchHistory(id:string):Promise<Result<{items:SearchHistoryEntry[]}>>;
  deleteSearchHistory(input:{document_id:string;history_id:string}):Promise<Result<{deleted:boolean}>>;
  clearSearchHistory(id:string):Promise<Result<{deleted:number}>>;
  candidates(input:{id:string;query:string}):Promise<Result<{items:(DocumentSummary&{shared_tags:string[]})[]}>>;
  searchDocuments(query:string):Promise<Result<{items:DocumentSummary[]}>>;
  relations(id:string):Promise<Result<{items:RelatedDocument[]}>>;
  addRelation(input:{id:string;related_id:string;description:string}):Promise<Result<{relation:RelatedDocument}>>;
  removeRelation(input:{id:string;related_id:string}):Promise<Result<{removed:boolean}>>;
  documentTopics(id:string):Promise<Result<{items:ResourceTopic[]}>>;
  addDocumentTopic(input:{document_id:string;topic_id:string}):Promise<Result<{linked:boolean}>>;
  removeDocumentTopic(input:{document_id:string;topic_id:string}):Promise<Result<{linked:boolean}>>;
  topicMaterials(id:string):Promise<Result<TopicMaterials>>;
  addTopicDocument(input:{topic_id:string;document_id:string}):Promise<Result<{linked:boolean}>>;
  removeTopicDocument(input:{topic_id:string;document_id:string}):Promise<Result<{linked:boolean}>>
}
export interface ParserSettings { enhanced_enabled:boolean; docling_executable:string; docling_prefix:string[]; libreoffice_executable:string; timeout_seconds:number; ocr_enabled:boolean; ocr_mode:'default'|'full_page'; ocr_engine:'auto'|'easyocr'|'rapidocr'|'tesseract'; version:number }
export interface ParserCapability { format:string; media_type:string; state:'builtin'|'external'|'component_missing'|'unsupported'; parser:string; detail:string; install_hint:string|null; processor:'builtin'|'docling' }
export interface ParserStatus { settings:ParserSettings; capabilities:ParserCapability[]; components:{docling:{available:boolean;version:string;detail:string};libreoffice:{available:boolean;path:string}}; tested_at?:string }
export interface ParsersBridge { choose(component:'docling'|'libreoffice'):Promise<Result<{cancelled:boolean;path?:string;prefix?:string[]}>>; status():Promise<Result<ParserStatus>>; save(input:ParserSettings):Promise<Result<ParserSettings>>; test():Promise<Result<ParserStatus>> }
export interface DesktopBridge { ai:AiBridge; workspace:WorkspaceBridge; suggestions:SuggestionsBridge; garden: GardenBridge; chat: ChatBridge; search: SearchBridge; notes: NotesBridge; resources:ResourcesBridge; layout: LayoutBridge; parsers:ParsersBridge; getStatus(): Promise<AppStatus>; documents: { preview(input:{id:string;action:'start'|'status'|'cancel'|'location'|'read'|'text'|'original';preview?:string;block?:string}):Promise<Result<any>>;openOriginal(id:string):Promise<Result<{opened:boolean}>>; readPdf(id: string): Promise<Result<Uint8Array>>; savePosition(input: {id: string; page: number}): Promise<Result<{page: number}>>; list(): Promise<Result<{items: DocumentRecord[]}>>; importPdf(): Promise<Result<ImportResult>>; importPdfs(): Promise<Result<ImportBatchResult>>; update(input: DocumentInput): Promise<Result<DocumentRecord>>; remove(input: {id: string; version: number}): Promise<Result<{removed: boolean; cleanup_pending: boolean}>>; reparse(input:{id:string;processor:'builtin'|'enhanced'}):Promise<Result<TaskRecord>>; blocks(id:string):Promise<Result<{items:DocumentBlock[]}>> }; tasks: { cancel(id: string): Promise<Result<TaskRecord>>; get(id: string): Promise<Result<TaskRecord>>; retry(id: string): Promise<Result<TaskRecord>> }; providers: { list(): Promise<Result<ProviderConfig[]>>; save(input: ProviderInput): Promise<Result<ProviderConfig>>; test(kind: ProviderKind): Promise<Result<ProbeResult>> } }

export interface AiPreferences{semantic_enabled:boolean;version:number}
export interface AiInput{kind:'search'|'chat'|'draft';target_id:string;text:string;request_id:string;base_revision_id?:string;scope?:AiScope}
export interface SearchHit{id:string;kind:string;object_id:string;title:string;snippet:string;snippet_start:number;snippet_end:number;document_id:string|null;physical_page:number|null;block_id?:string|null;block_type?:string|null;section_path?:string[]}
export interface AiSearchResult{query:string;items:SearchHit[];reason:string|null;filtered:boolean}
export interface AiTask{id:string;kind:string;target_id:string;status:string;stage:string;input:AiInput;result:(Partial<AiSearchResult>&{message_id?:string;suggestion_id?:string})|null;error:{code:string}|null}
export interface AiBridge{preferences():Promise<Result<AiPreferences>>;savePreferences(input:AiPreferences):Promise<Result<AiPreferences>>;run(input:AiInput):Promise<Result<AiTask>>;get(id:string):Promise<Result<AiTask>>;latest(input:{kind:AiInput['kind'];target_id:string}):Promise<Result<{items:AiTask[]}>>;cancel(id:string):Promise<Result<AiTask>>}

export type ProviderKind = 'chat' | 'embedding'
export interface ProviderConfig { kind: ProviderKind; base_url: string; model: string; version: number; has_key?: boolean; key_error?: boolean }
export interface ProviderInput extends ProviderConfig { key?: string; clear_key?: boolean }
export interface ProbeResult { ok: boolean; code: string; dimension?: number }
export type Result<T> = { ok: true; value: T } | { ok: false; code: string }

export interface DocumentRecord { id: string; original_name: string; title: string | null; authors: string[]; year: number | null; tags: string[]; summary_md: string | null; summary_source: string | null; summary_updated_at: string | null; version: number; page_count: number | null; last_page: number; extraction_status: string; warning: string | null; metadata_source: Record<string, string>; format?: string; media_type?: string; parser_name?: string | null; parser_version?: string | null; parse_status?: string | null; parse_warning?: string | null; parse_version?: number; parse_warnings?: {code:string;message:string;block_ordinal?:number|null}[]; task?: TaskRecord }
export interface TaskRecord { id: string; target_id: string; status: string; stage: string; progress: number | null }
export interface DocumentInput { id: string; version: number; title?: string | null; authors?: string[]; year?: number | null; tags?: string[]; summary_md?: string | null }
export interface ImportResult { cancelled?: boolean; document?: DocumentRecord; task?: TaskRecord; deduplicated?: boolean }
export interface ImportItem { name:string; ok:boolean; code?:string; document?:DocumentRecord; task?:TaskRecord; deduplicated?:boolean }
export interface ImportBatchResult { cancelled?:boolean; items:ImportItem[] }
export interface DocumentBlock { id:string; document_id:string; extraction_version:number; ordinal:number; block_type:string; text:string; section_path:string[]; physical_page:number|null; heading_level:number|null; location:{kind:'page'|'block';physical_page?:number|null;block_ordinal?:number|null;start_offset?:number|null;end_offset?:number|null} }
export interface ReaderTarget { page?:number; block_id?:string; evidence?:string; section_path?:string[] }

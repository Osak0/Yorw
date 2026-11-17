export interface MaterialChoice {kind:'assistant'|'settings'|'document'|'note'|'message';id:string;version:string;label:string}
export interface MaterialInput {kind:'assistant'|'settings'|'document'|'note'|'message';id:string;version:string;segment_ids:string[]}
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
export interface Topic { notebook_only?:number; id:string; parent_id:string|null; title:string; current_revision_id:string; version:number; created_at:string; updated_at:string }
export interface Revision { id:string; topic_id:string; ordinal:number; body_md:string; sources:unknown[]; origin:string; base_revision_id:string|null; restored_from_id:string|null; created_at:string }
export interface TopicView { topic:Topic; revision:Revision }
export interface TopicFields {title:string;parent_id:string|null}
export interface NotebookSummary{reading_note_id?:string;id:string;kind:'topic'|'document';title:string;topic_id?:string;document_id?:string;owner_title:string;excerpt:string;shared?:boolean;version:number;created_at:string;updated_at:string;base_revision_id?:string}
export interface NoteScope{topics:Topic[];rules:Record<string,boolean>;selected:string[];version:number}
export interface TopicOverview{topic:Topic;owned_notes:NotebookSummary[];notes:NotebookSummary[];documents:{id:string;title:string;original_name:string;year:number|null}[];topics:Topic[];relations?:{id:string;title:string;description:string}[];scope:NoteScope}
export interface GardenBridge {
 prepareReadingNote(input:{id:string;version:number}):Promise<Result<TopicView>>;
 readingHistory(id:string):Promise<Result<{items:{version:number;body_md:string;sources_json:string;created_at:string}[]}>>;
 notebookCatalog():Promise<Result<{items:NotebookSummary[]}>>;
 overview(id:string):Promise<Result<TopicOverview>>;
 noteScope(id:string):Promise<Result<NoteScope>>;
 saveNoteScope(input:{id:string;version:number;rules:Record<string,boolean>}):Promise<Result<NoteScope>>;
 notebook(id:string):Promise<Result<NotebookSummary&{body_md:string}>>;
 createNotebook(input:{id:string;topic_id:string;title:string}):Promise<Result<NotebookSummary>>;
 renameNotebook(input:{id:string;title:string;version:number}):Promise<Result<NotebookSummary>>;
 removeNotebook(input:{id:string;version:number}):Promise<Result<{removed:boolean}>>;
 movePreview(input:{id:string;parent_id:string|null}):Promise<Result<{affected:{id:string;title:string;before:string[];after:string[]}[]}>>;

 remove(input:{id:string;version:number;notebook_action?:string;destination_topic_id?:string|null}):Promise<Result<{removed:boolean;items:Topic[]}>>;
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
export interface ChatHistoryView { document_id:string;markdown:string;turn_count:number;compressed_turns:number;token_estimate:number;token_limit:number;compress_every:number;updated_at:string|null;compression_mode:string;export_available:boolean }
export interface ChatBridge { history(id:string):Promise<Result<ChatHistoryView>>; list(id: string): Promise<Result<{items: ChatMessage[]}>>; ask(input: ChatInput): Promise<Result<ChatMessage>>; cancel(id: string): Promise<Result<ChatMessage>>; note(id: string): Promise<Result<{id: string}>> }
export interface AppStatus { state: 'starting' | 'ready' | 'failed'; message: string; code?: string }
export interface Evidence { segment_id: string; chunk_id: string; document_id: string; document_title: string; physical_page: number; text: string; extraction_version: number; chunk_version: string; start_offset: number; end_offset: number; methods: string[]; score: number; similarity: number | null }export interface SearchResult { min_similarity: number; best_similarity: number | null; query: string; items: Evidence[]; mode: 'keyword' | 'hybrid'; reason: string | null; extraction_status: string; chunk_version: string }
export interface IndexStatus { keyword_ready: boolean; semantic_ready: boolean; segments: number; dimension: number | null; chunk_version: string; extraction_version: number; config: ProviderConfig | null; task: TaskRecord | null }
export interface SearchBridge { status(id: string): Promise<Result<IndexStatus>>; index(input: {id: string; semantic: boolean; config_version: number}): Promise<Result<TaskRecord>>; query(input: {id: string; query: string; semantic: boolean; config_version: number; min_similarity?: number}): Promise<Result<SearchResult>>; cancel(id: string): Promise<Result<TaskRecord>> }
export interface NoteSource {kind?:SourceRef['kind'];excerpt?:string; block_id?:string; extraction_version?:number; citation?: string; physical_page?: number; text?: string; available?: boolean }
export interface NoteRecord { id: string; document_id: string; body_md: string; sources: NoteSource[]; version: number; created_at: string; updated_at: string; document_available: boolean }
export interface NoteInput { id: string; document_id: string; body_md: string; version: number }
export interface NotesBridge { list(documentId: string): Promise<Result<{items: NoteRecord[]}>>; save(input: NoteInput): Promise<Result<NoteRecord>> }
export type WorkspaceLayoutModule = 'Storage' | 'Garden' | 'House'
export type WorkspaceLayoutSidebarMode = 'notes' | 'search' | 'chat'
export interface WorkspaceLayoutTab {kind:'assistant'|'settings'|'document'|'topic'|'topic-note'|'topic-create'|'topic-manage'|'notebooks'|'note-scope'|'linked-topics'|'notes'|'search'|'chat'|'resource'|'metadata'|'enrichment'|'ai'|'history'|'materials';id:string;title?:string}
export interface WorkspaceLayout {version:1;module:WorkspaceLayoutModule;tabs:WorkspaceLayoutTab[];activeKey:string|null;storageKey:string|null;gardenKey:string|null;sidebar?:{mode:WorkspaceLayoutSidebarMode;width:number};directoryCollapsed?:boolean;storageDirectoryCollapsed?:boolean;gardenView?:'tree'|'paths';gardenExpanded?:string[]}
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
export interface DesktopBridge { collaboration:CollaborationBridge; researchMemory:ResearchMemoryBridge; research:ResearchBridge; modelProfiles:ModelProfilesBridge; enrichment:EnrichmentBridge; ai:AiBridge; workspace:WorkspaceBridge; suggestions:SuggestionsBridge; garden: GardenBridge; chat: ChatBridge; search: SearchBridge; notes: NotesBridge; resources:ResourcesBridge; layout: LayoutBridge; parsers:ParsersBridge; getStatus(): Promise<AppStatus>; documents: { library(input:unknown):Promise<Result<any>>; preview(input:{id:string;action:'start'|'status'|'cancel'|'location'|'read'|'text'|'original';preview?:string;block?:string}):Promise<Result<any>>;openOriginal(id:string):Promise<Result<{opened:boolean}>>; readPdf(id: string): Promise<Result<Uint8Array>>; savePosition(input: {id: string; page: number}): Promise<Result<{page: number}>>; list(): Promise<Result<{items: DocumentRecord[]}>>; importPdf(): Promise<Result<ImportResult>>; importPdfs(): Promise<Result<ImportBatchResult>>; update(input: DocumentInput): Promise<Result<DocumentRecord>>; remove(input: {id: string; version: number}): Promise<Result<{removed: boolean; cleanup_pending: boolean}>>; reparse(input:{id:string;processor:'builtin'|'enhanced'}):Promise<Result<TaskRecord>>; blocks(id:string):Promise<Result<{items:DocumentBlock[]}>> }; tasks: { cancel(id: string): Promise<Result<TaskRecord>>; get(id: string): Promise<Result<TaskRecord>>; retry(id: string): Promise<Result<TaskRecord>> }; providers: { list(): Promise<Result<ProviderConfig[]>>; save(input: ProviderInput): Promise<Result<ProviderConfig>>; test(kind: ProviderKind): Promise<Result<ProbeResult>> } }

export interface AiPreferences{semantic_enabled:boolean;metadata_enabled?:boolean;version:number}
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

export interface DocumentRecord { folder_id?:string|null; id: string; original_name: string; title: string | null; authors: string[]; year: number | null; tags: string[]; summary_md: string | null; summary_source: string | null; summary_updated_at: string | null; version: number; page_count: number | null; last_page: number; extraction_status: string; warning: string | null; metadata_source: Record<string, string>; format?: string; media_type?: string; parser_name?: string | null; parser_version?: string | null; parse_status?: string | null; parse_warning?: string | null; parse_version?: number; parse_warnings?: {code:string;message:string;block_ordinal?:number|null}[]; task?: TaskRecord }
export interface TaskRecord { id: string; target_id: string; status: string; stage: string; progress: number | null }
export interface DocumentInput { id: string; version: number; title?: string | null; authors?: string[]; year?: number | null; tags?: string[]; summary_md?: string | null }
export interface ImportResult { cancelled?: boolean; document?: DocumentRecord; task?: TaskRecord; deduplicated?: boolean }
export interface ImportItem { name:string; ok:boolean; code?:string; document?:DocumentRecord; task?:TaskRecord; deduplicated?:boolean }
export interface ImportBatchResult { cancelled?:boolean; items:ImportItem[] }
export interface DocumentBlock { id:string; document_id:string; extraction_version:number; ordinal:number; block_type:string; text:string; section_path:string[]; physical_page:number|null; heading_level:number|null; location:{kind:'page'|'block';physical_page?:number|null;block_ordinal?:number|null;start_offset?:number|null;end_offset?:number|null} }
export interface ReaderTarget { page?:number; block_id?:string; evidence?:string; section_path?:string[] }

export interface EnrichmentSettings{enabled:boolean;version:number;enabled_at?:string|null}
export interface EnrichmentDecision{id:string;enrichment_id:number;action:'hide'|'restore'|'dismiss_tag'|'accept_topic'|'dismiss_topic';value:string}
export interface EnrichmentView{relation_snapshot:string;relations:{related:unknown[];topics:unknown[]};history:{id:number;created_at:string;extraction_version:number;hidden:number;prompt_version:string}[];document_version:number;metadata:{title:string|null;authors:string[];year:number|null;tags:string[];summary_md:string|null};enrichment:null|{provider:{model?:string};input_metadata:unknown;raw_result?:{links?:{related?:{id:string;title:string;version:number;reason:string}[];topics?:{id:string;title:string;version:number;reason:string}[];new_topics?:{title:string;reason:string}[]};overview:string;tags:string[];metadata?:{title?:string|null;authors?:string[]|null;year?:number|null}};id:number;extraction_version:number;hidden:boolean;stale:boolean;prompt_version:string;created_at:string;coverage:string[];result:{overview:string;research_question:string;method:string;data:string;conclusion:string;limitations:string;tags:string[];synonyms:string[];evidence_ids:string[]};recommendations:{topic_id:string;title:string;reason:string;evidence_ids:string[]}[]};task:null|{status:string;stage:string;error:{code:string;phase?:string;fields?:string[]}|null}}
export interface EnrichmentBridge{settings():Promise<Result<EnrichmentSettings>>;save(input:EnrichmentSettings):Promise<Result<EnrichmentSettings>>;view(id:string|{id:string;enrichment_id?:number}):Promise<Result<EnrichmentView>>;apply(input:{id:string;enrichment_id:number;version:number;fields:string[];mode:'replace'|'append';operations?:never}|{id:string;enrichment_id:number;version:number;operations:Record<string,string>;relation_snapshot:string}):Promise<Result<DocumentRecord>>;generate(id:string):Promise<Result<unknown>>;cancel(id:string):Promise<Result<EnrichmentView>>;decide(input:EnrichmentDecision):Promise<Result<EnrichmentView>>}

export interface ModelProfile {id:string;name:string;provider:'deepseek'|'kimi'|'glm'|'qwen'|'compatible';base_url:string;model:string;version:number;legacy_version:number|null;has_key?:boolean;key_error?:boolean;chat_check:string|null;tools_check:string|null}
export interface ModelDefaults {research_id:string|null;memory_id:string|null;version:number}
export interface ProfileInput {id:string;name:string;provider:ModelProfile['provider'];base_url:string;model:string;version:number;key?:string;clear_key?:boolean}
export interface ProfileCheck {id:string;profile_id:string;version:number;kind:'chat'|'tools';status:'running'|'completed'|'failed'|'cancelled';result:{ok:boolean;code:string;turns?:number;tool_calls?:number}|null}
export interface ModelProfilesBridge {list():Promise<Result<{items:ModelProfile[];defaults:ModelDefaults}>>;save(input:ProfileInput):Promise<Result<ModelProfile>>;defaults(input:ModelDefaults):Promise<Result<ModelDefaults>>;remove(input:{id:string;version:number}):Promise<Result<{removed:boolean}>>;test(input:{id:string;kind:'chat'|'tools'}):Promise<Result<{id:string;status:string}>>;check(id:string):Promise<Result<ProfileCheck>>;cancel(id:string):Promise<Result<{cancelled:boolean}>>}

export interface ResearchScope{mode:'workspace'|'topic';topic_id?:string|null}
export interface ResearchSession{id:string;title:string;scope:ResearchScope;version:number;archived:number;created_at:string;updated_at:string}
export interface ResearchSource{citation:string;kind:'document'|'note'|'topic';object_id:string;document_id?:string;title:string;text:string;page?:number;block_id?:string;available:boolean}
export interface ResearchTask{id:string;ordinal:number;session_id:string;question:string;body_md:string;status:string;error_code:string|null;sources:ResearchSource[];profile:{model:string;name:string};scope:ResearchScope;usage:{turns?:number;tool_calls?:number}}
export interface ResearchView{session:ResearchSession;items:ResearchTask[];before:number|null}
export interface ResearchAsk{session_id?:string|null;scope:ResearchScope;question:string;request_id:string;profile_id?:string}
export interface ResearchBridge{list():Promise<Result<{items:ResearchSession[]}>>;get(input:{id:string;before?:number}):Promise<Result<ResearchView>>;ask(input:ResearchAsk):Promise<Result<{session_id:string;task_id:string}>>;edit(input:{id:string;version:number;scope?:ResearchScope;archived?:boolean}):Promise<Result<ResearchSession>>;remove(input:{id:string;version:number}):Promise<Result<{removed:boolean}>>;cancel(id:string):Promise<Result<{stopped:boolean}>>;events(input:{id:string;after:number}):Promise<Result<{items:{sequence:number;task_id:string|null;kind:string;data:Record<string,unknown>;created_at:string}[]}>>}

export interface MemoryPreferences{enabled:boolean;daily_limit:number;cooldown_seconds:number;turn_threshold:number;event_threshold:number;input_limit:number;version:number}
export interface MemoryEntry{id:string;text_md:string;certainty:string;pinned?:number;event_ids?:number[];source_refs?:{text?:string;title?:string}[];progress?:{status?:string;next_step?:string}}
export interface MemoryView{scope_key:string;guide:string;entries:MemoryEntry[];forgotten:MemoryEntry[];exclusions:{object_kind:string;object_id:string}[];events:{id:number;kind:string;object_id:string;summary:string;text?:string;created_at:string}[];content_version:number;summary_version:number;mode:string;guide_estimate:number;memory_limit:number;markdown:string;log_markdown:string;versions:{id:number;content_version:number;created_at:string}[];preferences:MemoryPreferences}
export interface ResearchMemoryBridge{view(key:string):Promise<Result<MemoryView>>;edit(input:{scope_key:string;version:number;guide?:string;entry_id?:string;text?:string;action?:string;source_kind?:string;source_id?:string;restore_version?:number}):Promise<Result<MemoryView>>;preferences(input:MemoryPreferences):Promise<Result<MemoryPreferences>>;export(key:string):Promise<Result<{exported:boolean}>>}

export interface ProposalOperation {source_citations?:string[];target_title?:string;first_title?:string;second_title?:string;key:string;action:string;title:string;reason:string;owner:string;owner_title:string;target:string;first:string;first_kind:string;second:string;second_kind:string;body_md:string;after_body:string;before_body:string;diff:string;object_id:string;depends_on:string[]}
export interface CollaborationProposal {id:string;version:number;status:string;stale:boolean;conflict:string|null;operations:ProposalOperation[];sources:ResearchSource[];decision:{selected:string[];skipped_dependencies?:string[]}|null}
export interface RelationCandidate {kind:'document'|'topic';id:string;title:string;version:number;reason:string;excerpt:string;source:{kind:string;id:string;version:number}}
export interface CollaborationBridge {
 list(input:{task_id?:string;document_id?:string;topic_id?:string}):Promise<Result<{items:CollaborationProposal[]}>>;
 get(id:string):Promise<Result<CollaborationProposal>>;
 preview(input:unknown):Promise<Result<CollaborationProposal>>;
 decide(input:{id:string;action:'accept'|'reject'|'undo'|'repair';request_id:string;version:number;selected:string[]}):Promise<Result<CollaborationProposal>>;
 candidates(input:{kind:'document'|'topic';id:string;query?:string}):Promise<Result<{items:RelationCandidate[];mode:string}>>;
 topics(id:string):Promise<Result<{items:{id:string;title:string;description:string;version:number}[]}>>;
}

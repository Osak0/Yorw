# 当前架构与数据约定

main 已通过 PR #20 合并（d42bd37），为 schema 22；应用版本仍为 0.2.0。后续 v0.3.0 开发在 feature/Garden-interface-refine 分支进行。环境与命令见[开发指南](development.md)，当前状态见[PLAN](../PLAN.md)，阶段二证据见[阶段二记录](history/v0.3.0-phase2.md)。

## 模块与通信

```text
React renderer → 受限 preload IPC → Electron main → 本地 FastAPI → SQLite / PDF / 模型服务
```

| 位置 | 实际职责 |
| --- | --- |
| `apps/desktop/src/main/` | 窗口、原生对话框、safeStorage 密钥、Python 生命周期、业务 IPC、工作区布局校验/写入，以及 `resources.ts` 的资料/关系/检索历史转发。 |
| `apps/desktop/src/preload/`、`src/shared/` | 固定桥接操作和手写 TypeScript 合同（含 `layout:load/save`、`resources:*`）；变更时与 Python DTO 同步。 |
| `apps/desktop/src/renderer/` | Storage/Garden/House、工作标签与布局、PDF.js、原件与转换预览、CodeMirror、Markdown 预览、按实体会话状态、文献资料与关联材料视图。 |
| `services/api/src/yorw_api/` | 按业务文件组织 FastAPI/Pydantic、有限并发任务、模型协议和持久化；`resources.py` 管资料聚合与关系，`search_history.py` 管检索快照，`parsers.py` 管处理器设置、能力检测和显式重解析。 |
| `services/api/src/yorw_api/parsing/` | 版本化解析合同、能力表、注册表、内置 PDF/TXT/Markdown/DOCX 解析器、外部 Docling 适配器和 DOC LibreOffice 转换。业务只消费 `ParseResult`/内容块，不读取解析器私有结构。 |
| `storage/`、`migrations/` | 受管路径、SQLite 事务、完整性检查和顺序迁移。 |
| 两侧 `tests/`、`scripts/` | 自动化回归、构建、自编写样例生成及完整桌面复现。 |

main 启动 Python 时通过 stdin 传入工作区与会话令牌；后端监听 127.0.0.1 动态端口，HTTP 使用 Bearer 会话认证。健康握手成功才进入 ready。renderer 保持 contextIsolation/sandbox，关闭 Node 集成，IPC 检查来源窗口、mainFrame 和 URL；不开放任意路径、HTTP 或命令执行。

开发使用独立的 `Yorw-development` profile；正式运行使用 Electron userData。实际路径由 House 显示。工作区含 `yorw.sqlite3`、`documents/<uuid>.pdf`、`tmp/`、`logs/`、`backups/`；main 另管 `secrets/`，密钥不进数据库或普通日志。测试 profile 和数据位于报告目录，不使用真实用户库。

## 工作区界面、标签与布局

`workspace-tabs.ts` 定义工作标签：`document`、`topic`、`topic-create`、`topic-manage`、Storage 工具（`notes`/`search`/`chat`/`resource`/`metadata`）和 Garden 工具（`ai`/`history`/`materials`）。标签键为“类型:实体 ID”，文献与专题工具共用所属实体 ID；`topic-create` 使用固定 ID `new`（全局唯一），`topic-manage` 按专题 ID 去重。`moduleForTab` 决定归属 Storage 或 Garden。App 持有标签数组、激活键、当前模块和各模块最后活动键；模块导航清空当前激活键进入首页，标签栏激活标签时同步模块。布局恢复按当前文献/专题列表校验实体，跳过不存在的页面并提示；`topic-create` 恢复为空白新建页，已存在的 `topic-manage` 读取已保存目录值；损坏布局回到 Storage 首页。

侧栏与标签是同一份状态的两种宿主。Storage 的阅读标签渲染 PDF 与侧栏；工具标签渲染独立的 `DocumentTool`，整理文献由独立 `MetadataTool` 标签承载；文献资料中的“编辑元数据”也打开该标签。任一时刻只挂载一个宿主，工具输入/结果/编辑草稿按文献保存在 `session-state.ts`（页码、缩放、侧栏模式/宽度、检索与问答输入）、既有 `Notebook`/`GardenBook`，整理文献的元数据草稿在当前会话按文献保留。从侧栏“展开为标签”关闭侧栏宿主并激活工具标签；工具“返回阅读侧栏”移除工具标签、激活文献阅读标签并打开对应侧栏。工具标签中的来源跳转通过一次性 pending jump 激活目标文献的阅读标签，PDF 加载完成后定位物理页，不覆盖其他文献。

Storage 首页始终是文献列表：左侧目录显示文件名，单击文件夹展开后代，双击进入；未归类文献位于根目录。左侧保留唯一导入，中右侧是当前目录直属文献搜索和列表。搜索只在本地按标题、文件名、作者、年份、标签和总结过滤，不调用模型或后端。文献资料由 `DocumentResource` 的 activity 模式聚合 AI 生成记录、笔记、检索及问答历史；`MetadataTool` 承载正式字段编辑，复用 metadata 模式管理专题、双向文献关系和同标签推荐。标签只是查找线索，不自动建立关系；相关文献由用户手动关联，不等同学术引用，也不扩大 AI 材料范围。打开资料标签、查看历史或删除历史都不调用模型；界面中的“重新检索”才会创建新的检索任务。

Garden 首页不渲染侧栏，顶部提供新建专题、层级/路径视图切换、展开/收起全部、刷新和本地名称搜索；只有确实无专题时才显示新建空状态，搜索无匹配使用独立空状态。正文页左栏为可收起的专题目录（搜索、新建、共用树）；点击名称打开或激活正文标签，箭头只展开/收起，叶节点无箭头。正文、AI 优化、修订历史、关联材料和专题管理是独立标签；正文页保留标题/父级路径、编辑/预览/保存工具栏和主编辑器，不再内嵌名称/父级表单。新建页与管理页复用既有创建/更新 API；新建沿用稳定请求 ID，管理携带专题版本。`GardenBook` 在会话内保存新建/管理草稿，切换标签不丢，布局不保存未提交表单。AI 优化复用 `SuggestionsPanel` 与 `WikiReview`，修订历史复用既有 revision/source 比较和回退合同。关联材料区分本专题直接关联的文献与从后代专题汇集的文献；笔记按 ID 去重展示，正文仍归所属文献。解除关联只删除关系行，不删除笔记、PDF 或历史来源快照。目录移动后按当前树动态计算后代材料。

AI 优化的材料范围默认是当前专题及子专题，显式切换到全工作区才扩大范围。专题范围汇集直接/后代专题关联的文献、这些文献的笔记和后代专题的已保存 Wiki；当前专题的已保存正文只作为编辑背景，不作为独立证据召回。范围为空时在创建任务前返回 `NO_SCOPED_MATERIALS`，不静默回退全库。范围 ID、note/wiki 集合与指纹保存在建议的请求快照中；生成期间的关联/目录变化保留已有草稿，但列表标记 `scope_changed`，采纳时返回 `SCOPE_CHANGED`，要求重新生成或核对。草稿截断恢复、来源检查、修订校验和人工采纳语义没有改变。

主进程 `Layout` 将界面状态写入 `userData/workspace-layout.json`（不进入 SQLite）：版本 1，最多 50 个标签、标题最多 500 字符、文件上限 64 KiB；校验页面类型、UUID、唯一键、激活项与模块一致、Storage/Garden 键归属、侧栏宽度 320–480、专题/文献目录折叠布尔值，以及可选 `gardenView`（`tree`/`paths`）和 `gardenExpanded`（最多 500 个去重 UUID）；未知字段在写入时丢弃。旧布局缺少 Garden 字段时使用默认值。写入使用临时文件加 rename，并串行化；文件不含正文、密钥、聊天输入、任务结果或未提交表单。读取失败、版本/结构损坏或校验不通过时回退 Storage 首页。布局是界面便利状态，不是业务备份。

## 数据所有权与一致性

- UUID 为业务 ID，时间为 UTC，物理页码从 1 开始。导入保存受管 PDF 副本并按 SHA256 去重；原始文件不会因应用移除文献而删除。
- `documents/chunks` 保存文献元数据、抽取版本、页文本和阅读页码；`document_tags` 保存去空、去重后的标签；`documents.summary_md/summary_source/summary_updated_at` 保存统一总结及来源和更新时间。文献 ID 与受管路径不因改名或标签变化而改变。
- `document_relations` 每对文献只保存一行（`low_id < high_id`），说明为双向共享；`document_topics` 保存文献—专题多对多。关系解除只删除关系行，不删除文献、笔记或 Wiki 快照。
- `notes` 保存文献笔记及来源；`conversations/messages` 保存问题、输出、状态、来源和提示词/模型信息；`search_history` 保存实际提交的检索问题、时间、状态、摘录和来源引用快照。检索历史可单独删除或清空，不删除任务、笔记或对话。
- `topics` 管层级与当前修订指针；`revisions` 是不可变正文/来源快照；`suggestions` 独立保存生成草稿、基础修订、材料与请求；自动草稿的请求快照包含材料范围、范围指纹和来源版本；`wiki_decisions` 保证采纳、拒绝与回退幂等。
- `tasks` 持久化任务状态与进度；`provider_configs` 保存版本化地址和模型名，不保存 key；`ai_preferences/ai_requests` 保存检索偏好和一次输入的幂等请求。
- 旧 `search_documents/search_segments/index_generations/embeddings` 与新 `knowledge_sources/knowledge_segments/knowledge_vectors/knowledge_fts` 均为派生检索数据；原始页文本、修订及来源快照继续是权威记录。
- `documents` 保存格式、媒体类型、活动抽取版本、解析版本/状态、解析器与配置指纹；`document_blocks` 保存按版本和顺序排列的内容块、类型、章节路径、物理页（仅 PDF/OCR 有真实页）和定位。旧 `chunks` 继续作为 PDF 兼容索引，内容块 ID 与对应 chunk ID 一致；旧引用快照不重写，来源可用性按活动版本动态计算。
- 解析版本与活动版本分离：尝试解析递增 `parse_version`；成功才切换 `extraction_version` 并删除/失效派生索引；失败保留上一活动版本和其内容块，记录 `parse_status/parse_warning`。重新解析成功后旧内容块仍可按版本读取，但不再作为当前来源。
- `parser_settings` 保存增强解析开关、Docling/LibreOffice 路径、超时、OCR 开关/模式/引擎和版本；能力检测与测试只读取独立用户环境，不把组件装进 Yorw 运行时。
- 阶段一 schema 由 001–019 迁移组成（阶段二另追加 020，见末节）：012 增加文献标签与总结，013 增加检索历史，014 增加文献关系，015 增加文献—专题关系，016 增加内容块与解析版本，017 增加处理器设置，018 增加 OCR 引擎，019 增加 document_previews 和 preview_locations。升级已有库前用 SQLite backup API 备份；逐迁移事务、外键及完整性检查；校验历史 checksum，拒绝较新数据库。不要修改已应用 SQL。写入经 RLock 与短事务串行化，网络请求不占写事务，启用 WAL 和 busy_timeout。
- 正文保存比较 base_revision_id，目录修改比较 version。追加保留旧正文，合并原始来源并重排新增 S 编号；替换及回退创建新修订。动态 available 状态不写回不可变来源。

## 统一 AI 工作流

`ai_workflows.py` 统一处理 search/chat/draft。main 读取聊天与 embedding 独立密钥，经私有请求头交给后端；renderer 和任务 JSON 不持有密钥。前端提交 request_id 后轮询任务，后台依次准备、查找、筛选，再交接生成流；先持久化交接结果再派发调用，失败重试不额外创建生成请求。

`retrieval.py` 从活动 `document_blocks` 构建原文切片（PDF 页块或非 PDF 段落/表格/列表块），最多 800 字符、100 字符重叠。中文问句去填充词，FTS5/BM25 与归一化向量各召回最多 40 项；RRF 融合、去重后最多 20 项由现有聊天模型筛选，严格校验候选 ID 与句子下标。摘要仍是原文切片，模型不能改写引文。来源证据携带 `block_id`、`block_type`、`section_path` 和 PDF 物理页；专题草稿通过显式 document/note/wiki ID 集合过滤目录，不使用“当前选择”猜测归属。

| 场景 | 范围与预算 |
| --- | --- |
| 搜索 | 当前 PDF，最多 5 条，摘录最多 220 字符、显示 4 行，返回物理页跳转。 |
| 问答 | 当前 PDF，最多 8 条证据；近期最多 4 轮/6000 字符对话仅用于理解追问，重新查原文。无证据时本地拒答，不调用回答模型。 |
| 草稿 | 默认当前专题及子专题的关联文献、笔记和后代 Wiki；可显式切换全工作区。最多 12 条/24000 字符序列化材料；当前 Wiki 背景最多 20000 字符，完整原始基线不截断保存。 |

语义检索默认开启，House 可全局关闭。关闭时文字匹配留在本地；问答/草稿仍需聊天服务。缺配置、服务异常或超出向量规模预算时保留可用初步匹配。筛选模型不能保证相关性，真实质量需逐题评估。

向量按内容和配置版本缓存，同一派生索引并发构建共用锁。文献删除/重新抽取、笔记变更和 Wiki 指针切换使缓存失效，调用前后重检来源与版本。取消、设置变化和服务退出有阶段检查；中断任务重启后不自动重发，已生成部分正文保留。

`chat.py` 处理兼容 Chat Completions SSE；问答输出预算 4096 token，草稿 8192。`suggestions.py` 仅在明确 length 截断时自动续写一次，继续属于同一草稿；重复截断标 partial，过滤、资源不足、中断和协议错误分别处理。旧失败记录存在正文时可编辑恢复，但采纳仍检查来源、引用和基础修订。

搜索任务在提交时写入 `search_history`，完成、失败、中断或取消时更新状态；结果只保存短摘录、物理页和证据引用，不复制整篇 PDF。读取历史按当前提取版本、chunk 存在性、页码和引文动态计算 `available`，不把旧结果伪装成当前来源。重启时未完成的搜索任务和检索历史标为 interrupted，不自动重发。

## 导入与资料整理

导入在 main 通过固定的多选文件对话框读取本地 PDF/DOCX/DOC/MD/TXT，逐个上传到后端；后端按扩展名选择内置解析器，单个文件的大小、格式或后端错误只记录在该文件的导入结果中，不中止整批。每个结果显示成功、重复复用或失败原因；成功项提供非阻塞的“整理资料”入口和“打开阅读”；“整理资料”打开独立“整理文献”标签，不覆盖文献库。PDF 使用现有 PDF.js 阅读器；DOCX 直接读取原文件展示基础预览，Markdown/TXT 读取原始文本；Word 版式转换为用户主动选择的可选功能。引用首先显示依据，能匹配时辅助定位。导入默认不会请求总结模型；开启自动整理授权后，main 为之后新导入且解析就绪的文献排队，详见下节。

## 导出与扩展边界

内容导出在同一数据库锁内创建快照，ZIP 的 Markdown 与已保存正文一致，来源独立列入清单并补充文件格式与物理页/内容块定位；main 通过系统对话框保存，临时文件加 rename。导出仍只含已保存笔记和 Wiki 当前修订，不包含文献标签/总结、关系、检索历史或完整工作区。没有完整工作区恢复、云同步或外部 Markdown 双向同步。

旧检索/选材 API 保留兼容；现役界面走统一工作流。PDF 使用内置 pypdf 文字抽取，非 PDF 使用内置 TXT/Markdown/DOCX 解析或用户配置的 Docling；扫描 PDF 的 OCR 由 Docling 可选引擎完成，DOC 经用户安装的 LibreOffice 转换。图像语义理解、复杂版面和公式识别仍后置。


## 原件预览与设置隔离（阶段一整改）

`previews.DocumentPreviewProvider` 定义生成、状态、取消入口；`Previews` 使用独立单线程队列与取消事件，转换独立于 RAG 解析。原件仍不可变。预览缓存键由原件 SHA256、LibreOffice 路径、程序与版本文件指纹以及转换配置组成；新转换在独立临时目录完成后原子发布。预览只按文献 ID 和预览 ID 提供受控资源，删除文献同步取消并清理派生文件。中断转换可重试；失效缓存可重建，不作为正文权威。

转换 PDF 保存逐页文本，规范化匹配保留原始字符偏移，并排除重复页边文字；跨页匹配返回多个页内范围。只确认唯一的精确匹配；表格仅去除结构分隔符，重复或缺失内容明确未匹配。映射键包含预览 ID、内容块 ID 和 extraction_version；来源快照不被转换页号覆盖。PDF.js 在匹配页文本层高亮。搜索和问答继续使用 ReaderTarget；笔记、专题和修订来源通过 SourceNavigationContext 进入同一阅读入口。

House 的 settings 标签采用固定类别 ID，持久化只保存类别与标签状态；不保存表单或密钥草稿。表单组件保持挂载以保留草稿，关闭标签复用保存/放弃确认。main 通过原生文件选择与确认建立程序授权并在 main 私有文件保存组件指纹；重启时仅恢复文件未变化的授权；仅批准的组件路径可保存。Docling 启动参数固定为空或 Python 的 `-m docling`，后端也拒绝其他前缀；旧配置不会在启动或状态读取时执行。测试用脚本进程通过测试内部注入，不作为可配置产品功能。

解析任务在排队时捕获配置快照，导入请求不执行组件版本探测；实际解析在工作线程验证组件能力，避免外部程序阻塞数据库写事务。


## 基础能力独立（2026-10-29 再次整改）

`original_view.original_docx` 直接读取原始 OOXML，返回受限的展示树（段落/run/表格/栅格图片），不读取 SQLite 检索块来构建全文。压缩包条目、解压体积、节点深度、文字和图片总量受限；DTD/实体、外部关系、SVG 及任意 HTML 不进入视图。renderer 通过 React 文本/静态元素呈现，图片仅为受管 PNG/JPEG data URL。基础预览不是完整 Word 排版引擎，未覆盖页眉页脚、脚注和复杂分页。

导入固定走内置接口；旧 enhanced_enabled 字段为兼容设置保留，不再影响导入选择。增强解析仅显式重解析使用，LibreOffice 版式转换仅点击可选入口使用。旧 DOC 需要外部转换的边界明确提示，不虚报成无需依赖的完整 DOC 解析。

ReaderTarget 增加 evidence 与 section_path，引用操作首先显示依据；原件定位只是有条件的辅助行为。即使预览错误或来源块版本不可用，保存的依据也可以独立展示。DOCX 基础视图对唯一匹配节点做标记，转换页定位继续使用独立预览映射，不互相依赖。

## 阶段二：派生整理与检索适配

`enrichment.DocumentEnricher` 将已解析块分为最多 32 个章节/长度批次，每批文字上限 12000 字符，长块分片不丢尾部；多批结果再汇总，记录实际覆盖块。超过预算直接报错，不把首段概述称为全文总结。模型输出由 Pydantic 和来源 ID 集合校验，不执行文档内指令；合法来源编号不能证明语义真实性，仍需人工核查。

迁移 020 新增 `enrichment_preferences/document_enrichments/enrichment_decisions/enrichment_requests` 和文献级 `document_hint_index/document_hint_fts`，另给 ai_preferences 增加 metadata_enabled（默认关闭）。结果保存输入 extraction_version、模型配置指纹、Prompt 版本、覆盖和时间；tasks 保存任务快照与阶段。AI 生成记录单独保存，不自动改写正式 summary_md/document_tags；标签拒绝及专题忽略仍按解析版本保留，隐藏按每条结果记录并可恢复。旧结果在重解析后过期，失败保留旧结果。

main 的 `Enrichment` 通过受限 IPC 使用安全存储密钥，每三秒检查已授权新文献，单工作线程有序执行；密钥只经私有请求头传递，不进入任务和布局。普通查看不调用模型，失败/中断任务不会被扫描重发；手动重新生成是新的付费意图。关闭自动整理会取消未完成任务。取消不撤销已经发出的上游请求，但后续批次和提交检查会阻止结果发布；重启不自动重发。

提交结果在同一事务检查任务、文献版本、解析版本、配置与自动授权版本，取消或过期回调不能激活结果。专题推荐仅扫描已有标题、完整父路径和已保存正文，最多三个及支持块；确认时复查当前推荐，复用关系事务接口，不自动建专题或扩大生成范围。

`EvidenceRetriever`（兼容别名 Retriever）统一范围、RRF、去重与来源返回。`LexicalRetriever` 的实现为 SQLite FTS5/BM25；`VectorIndex` 当前由 SQLite 配置版本缓存与 NumPy 点积实现，支持受限查询、写入、删除、版本检查和重建。原文/SQLite 业务记录仍是权威数据，未引入 Chroma。

启用元数据方案时，标题、正式标签/总结和当前未隐藏 AI 字段进入独立文献级 FTS5 入口；同义词只取有限短术语，保留原始查询，不把整篇总结复制进每个切片。命中文献只能在本次允许集合中选择当前原文块，AI 证据 ID 再限制可选支持块；最后再次检查来源可用性。输出仍是原文摘录，AI 字段不是引用。本轮合成评估通过，但真实模型质量未完成，因此默认排序保持原方案。


## 逻辑文献目录（迁移 021）

library_folders 保存稳定 ID、parent_id、规范化名称及乐观版本；documents.folder_id 可空，旧文献迁移后未分类。目录服务独立于解析与检索，通过事务校验同级名称、32 层深度、循环及版本冲突。批量归类先验证全部文献版本再更新；不改变原件哈希、解析版本、来源 ID 或专题关系。非空目录删除提升子节点，同级重名则回滚。

受限 documents:library IPC 使用枚举操作。后端 UUID 路由解析受管原件并复用 Workspace 的重解析点/路径检查，main 处理系统打开、资源管理器定位和剪贴板；renderer 不提供路径或命令。绝对路径仅按用户请求显示，不进入布局和普通日志。目录选择与分隔条宽度在 renderer 本机 localStorage 保存，旧全部/未分类及缺失目录恢复到根目录；目录展示和右侧列表只消费直属归属。目录组织不参与 AI 证据授权，当前范围问答规则仍由原有来源系统控制。


## 界面与工作标签（整改阶段三）

workspace-ui.css 管理当前工作区的颜色、字号、按钮和密度；目录专用样式仍在 library-directory.css，原件/笔记/Garden/资料模块保留各自布局与滚动职责。SettingsIcon 使用本地 SVG，仅作装饰，入口有可见文字和原生按钮语义，无新依赖。

无标签时不渲染 tabbar；设置仍通过现有稳定 settings:id 标签和 House 表单注册表去重、恢复、保护草稿。模型预设的脏状态以当前已保存值或初始预设比较，未编辑预设不提示丢弃。密钥仍由用户输入后通过 main 安全保存，草稿不进入布局。文献管理 details 保留元数据、解析和删除操作，主要列表默认只呈现阅读和资料按钮。

### Garden 专题导航与标签页

`garden-tree.ts` 是纯函数目录层：按 `parent_id` 构造子节点、计算从根到当前专题的路径、祖先/后代集合、默认展开、名称搜索与父级选项。搜索返回匹配项与祖先可见集合，树只在渲染时临时展开祖先；清空搜索回到用户原有展开状态。管理父级选项排除自身及后代，后端仍做版本与循环校验。

`GardenBook` 扩展会话内 `create` 与 `manage` 草稿：新建草稿保存名称、父级、稳定请求 ID 和初始父级；已有脏草稿不因重复打开重置。管理草稿保存名称、父级、专题版本与基线；刷新目录只更新未编辑的基线，脏编辑保留。创建/更新成功后用返回的专题替换目录项，标签标题由 App 统一同步；移动不触碰正文、修订或来源。关闭修改后的新建/管理标签沿用统一关闭对话框，可创建/保存、放弃或取消，失败保持输入。表单内容不进入布局。

首页使用 `.garden-home`，正文使用 `.garden-workspace` + 可收起 `.garden-directory`，工具/新建/管理页不渲染重复目录。视图、展开状态、目录收起和标签均走现有布局/IPC，不新增数据库迁移或专属 API。

首页专题展示使用 `topicLocationLabel` 计算路径：层级树按根/一级/深层使用 18/16/14px 字号、600/500/400 字重与 24px 缩进，不使用专题图标；路径列表为单行式，16px 专题名在左、12px“根目录 › 父级”路径在右。chevron 仅表示展开状态；增强样式限定在 `.garden-index`，正文 `.garden-directory` 保持 13px 紧凑目录；不改变数据、IPC 或业务合同。


### 生成历史与元数据采纳（schema 22）

追加 022，不改写旧迁移。document_enrichments 新增 metadata_json/provider_json，保留输入元数据、无密钥的模型配置及 Prompt enrichment-evidence-v3；result_json 为完整原始结果，API 同时提供未过滤 raw_result 和兼容拒绝策略的 result。历史查询受文献 ID 约束；旧版本隐藏决策迁入逐条 hidden 后可恢复，不丢弃原输出。重解析只标记历史过期，不允许采纳过期结果。

ModelDocumentEnricher 在每批与汇总请求加入 current_metadata，作为参考而非证据；建议标题、作者和年份可省略，标签/总结沿用结果字段。enrichment:apply 仅接受白名单字段、文献/结果 ID、预期版本和 replace/append，main 不接收路径或模型密钥。服务在同一写事务检查文献与解析版本、验证字段、更新统一元数据、写入 enrichment_applications 前后值审计。追加标签按 casefold 去重，追加总结保留现有内容；来源标记 ai_confirmed。替换需用户确认，自动生成不执行采纳。

前端历史选择时禁止在切换未完成的记录上采纳；元数据编辑与采纳均使用乐观版本保护。资料页保留生成记录及活动，不重复提供字段或关系表单。菜单与目录归类不变更原件路径、解析版本和引用 ID。


### 单专题删除（schema 23）

`TopicActions` 复用文献目录的菜单视觉与键盘约定，通过 Context 为首页树/路径及正文侧栏提供实体操作；上方工具栏职责不变。删除确认使用原生模态 dialog；`GardenBook.remove` 阻止脏草稿与保存中删除，成功移除本专题的缓存并记录已删 ID，阻断晚到加载/刷新恢复已删项；App 清理对应 Garden 标签与当前项。

preload 仅暴露 `garden.remove({id,version})`，main 校验 UUID 与正整数版本，固定转发 `DELETE /v1/topics/{id}`。后端在同一写事务内检查版本，设置 `topics.deleted_at`，将直接子专题移动到原父级并递增其版本，解除目标 `document_topics` 关系、清理其派生知识索引。修订不可变触发器保持不变，不物理删除历史。schema 23 仅追加迁移，升级前沿用数据库备份机制。

专题列表、正文、父级校验、材料树、自动专题推荐、检索及来源可用性统一过滤已删除项。旧来源快照不改写，`source_status` 返回不可用；延迟保存/采纳通过 Garden 存活检查和事务拒绝。导出目录沿用有效专题列表，已删专题不作为新导出候选；已有导出快照保留。此轮不提供恢复/批量删除或递归删除。

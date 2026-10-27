# 当前架构与数据约定

适用 v0.2.0 数据合同与 v0.2.1 阶段 A/B 工作区界面 / schema 15。这里描述现役代码；环境和复现命令见[开发指南](development.md)，历史取舍见 [v0.2.0](history/v0.2.0.md)、[v0.2.1 阶段 A](history/v0.2.1-stage-a.md) 与 [v0.2.1 阶段 B](history/v0.2.1-stage-b.md)。

## 模块与通信

```text
React renderer → 受限 preload IPC → Electron main → 本地 FastAPI → SQLite / PDF / 模型服务
```

| 位置 | 实际职责 |
| --- | --- |
| `apps/desktop/src/main/` | 窗口、原生对话框、safeStorage 密钥、Python 生命周期、业务 IPC、工作区布局校验/写入，以及 `resources.ts` 的资料/关系/检索历史转发。 |
| `apps/desktop/src/preload/`、`src/shared/` | 固定桥接操作和手写 TypeScript 合同（含 `layout:load/save`、`resources:*`）；变更时与 Python DTO 同步。 |
| `apps/desktop/src/renderer/` | Storage/Garden/House、工作标签与布局、PDF.js、CodeMirror、Markdown 预览、按实体会话状态、文献资料与关联材料视图。 |
| `services/api/src/yorw_api/` | 按业务文件组织 FastAPI/Pydantic、有限并发任务、模型协议和持久化；`resources.py` 管资料聚合与关系，`search_history.py` 管检索快照。 |
| `storage/`、`migrations/` | 受管路径、SQLite 事务、完整性检查和顺序迁移。 |
| 两侧 `tests/`、`scripts/` | 自动化回归、构建、自编写样例生成及完整桌面复现。 |

main 启动 Python 时通过 stdin 传入工作区与会话令牌；后端监听 127.0.0.1 动态端口，HTTP 使用 Bearer 会话认证。健康握手成功才进入 ready。renderer 保持 contextIsolation/sandbox，关闭 Node 集成，IPC 检查来源窗口、mainFrame 和 URL；不开放任意路径、HTTP 或命令执行。

开发使用独立的 `Yorw-development` profile；正式运行使用 Electron userData。实际路径由 House 显示。工作区含 `yorw.sqlite3`、`documents/<uuid>.pdf`、`tmp/`、`logs/`、`backups/`；main 另管 `secrets/`，密钥不进数据库或普通日志。测试 profile 和数据位于报告目录，不使用真实用户库。

## 工作区界面、标签与布局

`workspace-tabs.ts` 定义工作标签：`document`、`topic`、Storage 工具（`notes`/`search`/`chat`/`resource`）和 Garden 工具（`ai`/`history`/`materials`）。标签键为“类型:实体 ID”，文献与专题工具共用所属实体 ID；`moduleForTab` 决定归属 Storage 或 Garden。App 持有标签数组、激活键、当前模块和各模块最后活动键；模块导航清空当前激活键进入首页，标签栏激活标签时同步模块。布局恢复按当前文献/专题列表校验实体，跳过不存在的页面并提示；损坏布局回到 Storage 首页。

侧栏与标签是同一份状态的两种宿主。Storage 的阅读标签渲染 PDF 与侧栏；工具标签渲染独立的 `DocumentTool`。任一时刻只挂载一个宿主，工具输入/结果/编辑草稿按文献保存在 `session-state.ts`（页码、缩放、侧栏模式/宽度、检索与问答输入）或既有 `Notebook`/`GardenBook`。从侧栏“展开为标签”关闭侧栏宿主并激活工具标签；工具“返回阅读侧栏”移除工具标签、激活文献阅读标签并打开对应侧栏。工具标签中的来源跳转通过一次性 pending jump 激活目标文献的阅读标签，PDF 加载完成后定位物理页，不覆盖其他文献。

Storage 的文献资料标签由 `DocumentResource` 聚合：标题/文件、作者年份、标签、人工总结（来源与更新时间）、所属专题、双向相关文献、相同标签辅助查找、笔记、检索历史和问答历史。标签只是查找线索，不自动建立关系；相关文献由用户手动关联，不等同学术引用，也不扩大 AI 材料范围。打开资料标签、查看历史或删除历史都不调用模型；界面中的“重新检索”才会创建新的检索任务。

Garden 正文、AI 优化、修订历史和关联材料是所属专题的四个标签。正文页保留标题/父级路径、折叠的名称与父级入口、编辑/预览/保存/AI 优化/修订历史/关联材料工具栏和主编辑器；AI 优化复用 `SuggestionsPanel` 与 `WikiReview`，修订历史复用既有 revision/source 比较和回退合同。关联材料区分本专题直接关联的文献与从后代专题汇集的文献；笔记按 ID 去重展示，正文仍归所属文献。解除关联只删除关系行，不删除笔记、PDF 或历史来源快照。目录移动后按当前树动态计算后代材料。AI 选材、草稿截断恢复、来源检查、修订校验和人工采纳语义没有因界面拆分改变。

主进程 `Layout` 将界面状态写入 `userData/workspace-layout.json`（不进入 SQLite）：版本 1，最多 50 个标签、标题最多 500 字符、文件上限 64 KiB；校验页面类型、UUID、唯一键、激活项与模块一致、Storage/Garden 键归属、侧栏宽度 320–480 和目录折叠布尔值，未知字段在写入时丢弃。写入使用临时文件加 rename，并串行化；文件不含正文、密钥、聊天输入或任务结果。读取失败、版本/结构损坏或校验不通过时回退 Storage 首页。布局是界面便利状态，不是业务备份。

## 数据所有权与一致性

- UUID 为业务 ID，时间为 UTC，物理页码从 1 开始。导入保存受管 PDF 副本并按 SHA256 去重；原始文件不会因应用移除文献而删除。
- `documents/chunks` 保存文献元数据、抽取版本、页文本和阅读页码；`document_tags` 保存去空、去重后的标签；`documents.summary_md/summary_source/summary_updated_at` 保存人工总结及来源和更新时间。文献 ID 与受管路径不因改名或标签变化而改变。
- `document_relations` 每对文献只保存一行（`low_id < high_id`），说明为双向共享；`document_topics` 保存文献—专题多对多。关系解除只删除关系行，不删除文献、笔记或 Wiki 快照。
- `notes` 保存文献笔记及来源；`conversations/messages` 保存问题、输出、状态、来源和提示词/模型信息；`search_history` 保存实际提交的检索问题、时间、状态、摘录和来源引用快照。检索历史可单独删除或清空，不删除任务、笔记或对话。
- `topics` 管层级与当前修订指针；`revisions` 是不可变正文/来源快照；`suggestions` 独立保存生成草稿、基础修订、材料与请求；`wiki_decisions` 保证采纳、拒绝与回退幂等。
- `tasks` 持久化任务状态与进度；`provider_configs` 保存版本化地址和模型名，不保存 key；`ai_preferences/ai_requests` 保存检索偏好和一次输入的幂等请求。
- 旧 `search_documents/search_segments/index_generations/embeddings` 与新 `knowledge_sources/knowledge_segments/knowledge_vectors/knowledge_fts` 均为派生检索数据；原始页文本、修订及来源快照继续是权威记录。
- 当前 schema 由 001–015 迁移组成：012 增加文献标签与总结，013 增加检索历史，014 增加文献关系，015 增加文献—专题关系。升级已有库前用 SQLite backup API 备份；逐迁移事务、外键及完整性检查；校验历史 checksum，拒绝较新数据库。不要修改已应用 SQL。写入经 RLock 与短事务串行化，网络请求不占写事务，启用 WAL 和 busy_timeout。
- 正文保存比较 base_revision_id，目录修改比较 version。追加保留旧正文，合并原始来源并重排新增 S 编号；替换及回退创建新修订。动态 available 状态不写回不可变来源。

## 统一 AI 工作流

`ai_workflows.py` 统一处理 search/chat/draft。main 读取聊天与 embedding 独立密钥，经私有请求头交给后端；renderer 和任务 JSON 不持有密钥。前端提交 request_id 后轮询任务，后台依次准备、查找、筛选，再交接生成流；先持久化交接结果再派发调用，失败重试不额外创建生成请求。

`retrieval.py` 按页内段落/句子生成原文切片，最多 800 字符、100 字符重叠。中文问句去填充词，FTS5/BM25 与归一化向量各召回最多 40 项；RRF 融合、去重后最多 20 项由现有聊天模型筛选，严格校验候选 ID 与句子下标。摘要仍是原文切片，模型不能改写引文。

| 场景 | 范围与预算 |
| --- | --- |
| 搜索 | 当前 PDF，最多 5 条，摘录最多 220 字符、显示 4 行，返回物理页跳转。 |
| 问答 | 当前 PDF，最多 8 条证据；近期最多 4 轮/6000 字符对话仅用于理解追问，重新查原文。无证据时本地拒答，不调用回答模型。 |
| 草稿 | 全工作区的文献、笔记、其他 Wiki，最多 12 条/24000 字符序列化材料；当前 Wiki 背景最多 20000 字符，完整原始基线不截断保存。 |

语义检索默认开启，House 可全局关闭。关闭时文字匹配留在本地；问答/草稿仍需聊天服务。缺配置、服务异常或超出向量规模预算时保留可用初步匹配。筛选模型不能保证相关性，真实质量需逐题评估。

向量按内容和配置版本缓存，同一派生索引并发构建共用锁。文献删除/重新抽取、笔记变更和 Wiki 指针切换使缓存失效，调用前后重检来源与版本。取消、设置变化和服务退出有阶段检查；中断任务重启后不自动重发，已生成部分正文保留。

`chat.py` 处理兼容 Chat Completions SSE；问答输出预算 4096 token，草稿 8192。`suggestions.py` 仅在明确 length 截断时自动续写一次，继续属于同一草稿；重复截断标 partial，过滤、资源不足、中断和协议错误分别处理。旧失败记录存在正文时可编辑恢复，但采纳仍检查来源、引用和基础修订。

搜索任务在提交时写入 `search_history`，完成、失败、中断或取消时更新状态；结果只保存短摘录、物理页和证据引用，不复制整篇 PDF。读取历史按当前提取版本、chunk 存在性、页码和引文动态计算 `available`，不把旧结果伪装成当前来源。重启时未完成的搜索任务和检索历史标为 interrupted，不自动重发。

## 导出与扩展边界

内容导出在同一数据库锁内创建快照，ZIP 的 Markdown 与已保存正文一致，来源独立列入清单；main 通过系统对话框保存，临时文件加 rename。导出仍只含已保存笔记和 Wiki 当前修订，不包含文献标签/总结、关系、检索历史或完整工作区。没有完整工作区恢复、云同步或外部 Markdown 双向同步。

旧检索/选材 API 保留兼容；现役界面走统一工作流。PDF 当前用可替换的 pypdf 文字抽取，无 OCR、图像观察或复杂版面理解。扩展先依据失败案例验证，不以增加 Skill/插件替代来源与数据合同。

# 步骤 0：工程与数据基线

日期：2026-10-22 · 状态：步骤 0 已通过用户 review，设计分支已合并；本文保留设计约定，实际实现进度见 PLAN 与各步骤验收记录（步骤 2、3 已通过 review）。

本文落实 [PLAN.md](../PLAN.md) 步骤 0。范围以 PLAN 的首版调整为准；[产品设计](../product_design.md) 保留长期愿景。本文定义实现约定，表格不是现有数据库，接口不是已运行 API。环境实测、限制与验收索引见 [步骤 0 记录](dev-evidence/step-00.md)。

## 1. 范围与设计决定

首版仅实现个人本地工作区：PDF 导入/阅读、基础元数据、笔记、单篇问答、选材生成 Wiki、确认/修订/回退、内容导出。按 PLAN 后置完整 AI 信息卡、时间线、Memory、个人资料、持续主题聊天和完整备份恢复。所有规划均不等于已验证的产品能力。

- 保留 Electron/React/Python/SQLite 架构；不因本机默认 Python 为 3.13 更换 Python 3.12 基线。
- SQLite 管正文与历史，文件系统管 PDF；不用 Markdown 双向同步。这样无需解决两套正文源之间的冲突。
- 主题节点与 Wiki 页面合一；正文只存在修订快照中，页面指向当前修订，避免两份正文漂移。
- 引用随内容保存不可变快照，同时保留原始 ID。重建索引、删除文献后仍可解释旧结论的出处，但必须显示来源状态。
- 聊天和 embedding 独立配置。先验证一组真实服务，不预建多个厂商 SDK、自动路由或 Agent 框架。
- 仅添加到相应步骤需要的依赖；步骤 1 已选方案三（顶部导航、蓝色主题），见[统一设计说明](design/step-01/design_ui.md)。全局入口固定命名 Storage、Garden、House，不得替换为通用名称；本步不创建界面或应用骨架。

## 2. 目录与职责

以下为后续按步骤创建的目标结构，当前不创建空模块：

```text
Yorw/
  README.md / PLAN.md / product_design.md
  package.json / pnpm-workspace.yaml / pnpm-lock.yaml
  apps/desktop/
    package.json / electron.vite.config.ts
    src/main/          # 窗口、对话框、密钥、后端进程、IPC 转发
    src/preload/       # 按业务操作列出的安全桥接
    src/renderer/      # 文献、专题、设置及共享 UI
    src/shared/        # IPC 操作及事件类型，不含 Node 权限或密钥
    tests/
  services/api/
    pyproject.toml / uv.lock / .python-version
    src/yorw_api/
      api/             # HTTP 输入输出校验与错误映射
      services/        # 文献、问答、专题、任务业务
      storage/         # SQLite 连接、事务、查询、迁移
      providers/       # 聊天与 embedding 接口、兼容适配器
      migrations/      # 有序 SQL，按功能步骤增加
      prompts/         # 带版本的问答与 Wiki 模板
    tests/
  docs/                # 设计与 dev-evidence
  scripts/             # 有实际需要时添加环境检查/构建脚本
```

不建立通用插件系统或额外 shared Python 包。HTTP DTO 由 Pydantic 定义，后续从 FastAPI OpenAPI 生成前端类型，IPC 桥只暴露所需子集；接口调整同一步同步更新 DTO、类型和验证记录，禁止维护两套独立字段定义。

运行数据根为 Electron `userData/workspace/`：`yorw.sqlite3`、`documents/<uuid>.pdf`、`tmp/`、脱敏 `logs/`；密钥密文由 main 在 userData 的独立配置文件中管理，不放 SQLite。数据库存相对文件路径，外部路径仅通过原生文件对话框由 main 获取。开发与正式应用用不同 userData，测试只用临时目录。

步骤 2 扩充 `.gitignore`：Python `.venv`、`__pycache__`、测试缓存、构建/打包产物、临时数据及密钥；锁文件、迁移、无密钥配置样例进入版本控制。保留现有忽略规则，不将真实论文或用户库作为默认测试夹具。

## 3. 最小数据模型

通用规则：业务 ID 为 UUID 字符串；时间为 UTC ISO 8601 字符串；物理页码从 1 开始；SQLite 布尔为 0/1。`?` 表示可空，`JSON` 是经 Pydantic 校验后保存的 TEXT。除表中明确的复合键外，`id` 为主键；可编辑实体使用递增整数 `version`，写入携带旧版本。所有连接显式启用外键。

| 表/对象 | 最小字段与约束 | 首次落地步骤 |
| --- | --- | --- |
| schema_migrations | version INTEGER PK、checksum、applied_at；禁止改写已应用迁移 | 3 |
| documents | id、sha256 UNIQUE、relative_path?、original_name、title?、authors_json、year?、metadata_source_json、page_count?、extraction_status、extraction_version、active_index_generation?、last_page、version、created_at、updated_at、deleted_at? | 5 |
| chunks | id、document_id FK、extraction_version、ordinal、physical_page、text；UNIQUE(document_id, extraction_version, ordinal)；页码必须为正 | 5；步骤 8 加检索索引 |
| notes | id、document_id? FK、topic_id? FK、body_md、sources_json、version、created_at、updated_at；两个所属字段恰有一个非空 | 7；步骤 10 增加 topic_id |
| conversations | id、document_id FK、created_at；首版每篇文献一个会话，document_id UNIQUE | 9 |
| messages | id、conversation_id FK、ordinal、role、body_md、status、sources_json、provider_snapshot_json、prompt_version?、request_id?、created_at；UNIQUE(conversation_id, ordinal) | 9 |
| topics | id、parent_id? 自引用 FK、title、current_revision_id?、version、created_at、updated_at；父子关系不能形成环 | 10 |
| revisions | id、topic_id FK、ordinal、body_md、sources_json、origin、restored_from_id?、created_at；UNIQUE(topic_id, ordinal)；保存后不可修改 | 10 |
| suggestions | id、topic_id FK、base_revision_id FK、body_md、sources_json、materials_json、provider_snapshot_json、prompt_version、status、created_at；不充当正式正文 | 11 |
| tasks | id、kind、target_id?、status、stage、progress?、input_json、result_json?、error_json?、created_at、updated_at；输入不含密钥 | 5 |
| provider_configs | kind PK(chat/embedding)、base_url、model、options_json、version、updated_at；无明文或密文 key，仅 main 管理 key | 4 |
| embeddings | chunk_id FK、generation_id、config_fingerprint、dimension、vector BLOB；PK(chunk_id, generation_id)；float32 little-endian，长度=dimension×4 | 8 |
| chunks_fts | FTS5 虚拟表：chunk_id UNINDEXED、document_id UNINDEXED、text；非权威数据，可从当前 chunks 重建 | 8 |

不为简单来源关系额外创建多种 join 表，首版以有类型的 JSON 快照保存；JSON 内 ID 的存在性、归属与状态由服务层在事务内校验。可查询的主要关系仍用外键；以后有复杂查询需求再迁移，不能依赖未校验 JSON 实现权限或证据过滤。

`SourceRef` 固定为：`source_id`（本次内容内引用标识）、`kind`（document/note/message）、`source_object_id`、`source_version`、`excerpt`、`evidence[]`。`EvidenceRef` 包含 `document_id`、`document_title` 快照、`chunk_id`、`physical_page`、`quote`、`extraction_version`。笔记/消息没有原文依据时允许 evidence 为空，但只能标为用户观点或模型推断，不能被呈现为论文证据。材料快照保留被选笔记/消息原文及其引用，避免后续编辑改变旧生成依据。

状态规则：

- 文献抽取：pending → running → ready/partial/failed/unsupported；partial 必须携带警告，未抽出的内容不参与问答。
- 任务：queued → running → succeeded/failed/cancelled/interrupted；启动时将遗留 running 标为 interrupted，用户重试生成新任务；不自动重发可能重复计费的模型调用。
- 消息：streaming → completed/cancelled/failed/interrupted；用户消息直接 completed。取消/失败保留已收到内容与状态，重试新增消息而非伪改历史。
- 建议：draft → accepted/rejected；冲突时仍为 draft，不能写入正式正文。

### 数据一致性

1. 导入先写临时副本、计算摘要、原子移动到受管路径，再记录文献/任务；失败清理临时文件。启动对账只处理已知临时/孤立导入文件，不扫描删除用户任意路径。重复摘要返回既有文献；已删除文献重新导入可复用其 ID，但旧证据仍按抽取版本显示历史状态。
2. 文献删除采用 tombstone，事务内设置 deleted_at、移除 chunks/embedding/FTS 并停用相关任务；事务提交后删除受管 PDF，失败显示“文件清理待重试”。笔记、消息、修订中的证据快照保留且标为来源失效；这是移除文献，不是擦除所有历史文本。删除确认必须说明这一点。
3. 重建索引先生成独立 generation；全部完成后事务切换 active_index_generation，随后清理旧向量。检索限定当前文献、当前抽取版本和匹配的 embedding 配置；配置改变时旧向量不参与新配置检索，重建失败可回退关键词检索。
4. Wiki 保存/采纳/回退用单事务比较 base_revision_id，创建不可变修订并更新当前指针；同一事务校验该修订属于该主题。首次建页创建空正文的第 1 个修订；防止“空基线”歧义。冲突返回 409 与当前版本，前端保留用户草稿。
5. 普通笔记/元数据保存同样检查 version。目录改父级在事务内检查祖先链；首版不提供主题递归删除，避免无必要的数据删除策略扩张。

## 4. API 与桌面桥接约定

Python API 前缀 `/v1`，JSON 字段 snake_case。返回普通对象或 `{items: [...]}`；错误统一 `{error: {code, message, retryable, details?}, request_id}`，不泄露路径、key 或上游原始请求头。422 输入错误、404 不存在、409 版本冲突、503 后端/模型未就绪；厂商失败使用可分类错误码，不把所有问题写成“网络错误”。列表首版为本地小库全量列表，不预建复杂分页。

| preload 暴露的业务操作 | main → Python 的对应接口 | 主要输入 → 输出 |
| --- | --- | --- |
| app.getStatus | GET /v1/health | 无 → api_version、ready、schema_version、各连接是否已配置；不返回令牌 |
| documents.importPdf | POST /v1/documents/import | main 原生选文件并读取上传 multipart；renderer 无路径参数 → document、task、deduplicated |
| documents.list/get/update/remove | GET /v1/documents；GET/PATCH/DELETE /v1/documents/{id} | id；PATCH 字段+version；DELETE version → 文献/删除结果 |
| documents.readPdf | GET /v1/documents/{id}/file | id → PDF 字节；main 转为受限字节响应供 PDF.js，不给 renderer 后端地址或任意路径访问 |
| documents.savePosition | PATCH /v1/documents/{id}/position | page → 已保存页码；独立于元数据 version，限制在有效页数内 |
| notes.list/create/update | GET/POST /v1/notes；PATCH /v1/notes/{id} | 所属文献/专题、body_md、sources、version → note |
| providers.get/save/test | GET /v1/providers；PUT /v1/providers/{kind}；POST /v1/providers/{kind}/test | 配置、测试种类 → 脱敏配置/测试结果；key 由 main 另行保存并注入 |
| tasks.get/cancel/retry | GET /v1/tasks/{id}；POST /v1/tasks/{id}/cancel、/retry | id → task 或新 task_id |
| documents.reindex/search | POST /v1/documents/{id}/index、/search | 查询/索引请求 → task 或 evidence candidates（ID、分数、文本、页码） |
| chat.history/ask | GET/POST /v1/documents/{id}/messages | question、request_id → 历史或 message_id+task_id；上下文由后端受控选择 |
| topics.list/create/update | GET/POST /v1/topics；PATCH /v1/topics/{id} | title、parent_id、version → topic |
| topics.get/saveBody | GET /v1/topics/{id}；POST /v1/topics/{id}/revisions | body_md、sources、base_revision_id → revision、topic |
| topics.generate | POST /v1/topics/{id}/suggestions | materials[{kind,id,version}]、instruction、base_revision_id → task_id |
| topics.getSuggestion/accept/reject | GET /v1/suggestions/{id}；POST /v1/suggestions/{id}/accept、/reject | 确认可含用户修改的 body_md/sources、base_revision_id → revision 或建议状态 |
| topics.revisions/restore | GET /v1/topics/{id}/revisions；POST /v1/topics/{id}/restore | revision_id、base_revision_id → 新 revision |
| workspace.info/export | GET /v1/workspace；POST /v1/exports；GET /v1/exports/{task_id}/file | 对象 IDs → 导出任务；完成后 main 获取含 Markdown/来源清单的 ZIP 字节并经原生对话框保存，不接受 renderer 任意路径 |
| events.subscribe | GET /v1/tasks/{id}/events（SSE） | task_id → 按序事件；main 通过受限 IPC 转发，提供取消订阅函数 |

原生文件选择取消返回 cancelled，不计业务失败。renderer 仅在用户输入 key 时短暂持有表单值，经专用 IPC 提交后清空；保存后不得读回 key。main 密钥密文保存成功后才更新 provider 配置；失败不报成功。Python 内存中的 key 由 main 通过会话鉴权的内部配置操作提供，不入库。没有 key 时仍允许保存配置，状态显示未配置完整。密钥安全能力不可用时拒绝持久化，不能悄悄降级明文。

main 生成会话令牌，经子进程 stdin 传入，Python 绑定端口 0 并以启动消息返回实际端口；stdout 仅用于握手，业务日志走脱敏日志通道。main 健康检查成功后才暴露 ready；renderer 从不获得令牌、端口或通用 HTTP/IPC 方法。校验 IPC 调用来源，只允许应用主窗口；Python 所有业务请求要求令牌。

流式事件信封为 `{task_id, seq, type, payload}`；type 为 progress/text_delta/citations/completed/failed/cancelled。text_delta 含 message_id 与文本；citations 含经过校验的 SourceRef；completed 在数据库提交成功后发送。事件不承诺断线重放，断线时查询任务与已保存消息，不能重新请求模型冒充续传。取消为尽力停止，已经发生的服务商费用不承诺撤销。

提交问答时 request_id 保存于 assistant 消息，并以 (conversation_id, request_id) 非空唯一索引约束；用户消息的 request_id 为空。重复提交返回原 message/task，不重复计费调用；用户明确重试使用新 request_id。任务 target_id 指向该 assistant 消息。单会话只允许一个生成任务，其他请求返回 409。Wiki 生成先保存材料与基础修订的快照，再开始模型任务，完成后写 suggestions 并在任务结果返回 suggestion_id。模型未能产出合法引用时以失败或无依据结果呈现，不能补造引用 ID。

Python 内部最小接口：`ChatProvider.stream(messages, options, cancel)` 产出文本增量与结束信息；`EmbeddingProvider.embed(texts, config)` 返回按输入顺序排列的向量；`Retriever.search(query, document_ids)` 返回带来源候选；`PdfExtractor.extract(file)` 返回按页文本及警告。它们只做相应职责，不互相写数据库；业务服务统一安排事务、任务、模型调用及引用校验。

## 5. 迁移与依赖锁定

### 数据迁移

- 迁移按首次落地步骤添加，而非在步骤 3 一次创建全部功能表：工作区/迁移 → provider → 文献/片段/任务 → 笔记 → 检索 → 对话 → 专题/修订 → AI 建议。每个 SQL 文件有递增编号，schema_migrations 保存内容 SHA-256。
- 启动先检查迁移版本和 checksum；数据库版本高于程序支持版本时拒绝打开写模式，提示使用匹配版本。已应用文件 checksum 不一致时停止，不自动修补用户库。
- 升级已有库前使用 SQLite backup API 创建内部迁移备份；不是面向用户的完整备份功能。备份失败不执行升级。
- 每次迁移用显式事务执行，成功后记录版本，再提交；失败回滚且不更新版本。启用外键在事务外执行；迁移后执行 foreign_key_check 与 integrity_check。不要用隐式提交破坏迁移原子性。
- SQLite 单写入队列、短事务、busy_timeout；网络请求和 PDF 抽取不占用写事务。采用 WAL，备份不直接复制运行中的单个 .sqlite3 文件。
- 验证空库初始化、旧版本升级、失败回滚、重复启动无重复应用、较新版本拒绝与引用完整性；在步骤 3 及后续 schema 变化时落实。

### 工具链与锁文件策略

步骤 0 只读检查；步骤 2 才准备环境和安装依赖。候选工具链为本机已发现的 Node 24.14.0、pnpm 11.25.0、Python 3.12.10、uv 0.11.3；这只是候选组合，不是已通过整套构建的兼容矩阵。

- pnpm：根工作区包含 apps/desktop，根 packageManager 固定已验证 pnpm 版本，Node 版本写入工程版本文件；提交 pnpm-lock.yaml。初次安装生成锁文件，后续复现使用 `pnpm install --frozen-lockfile`。
- Python：services/api 独立项目与 `.venv`，requires-python 为 `>=3.12,<3.13`，`.python-version` 固定实际验证的补丁版本；提交 pyproject.toml 与 uv.lock。后续使用 `uv sync --locked`，不通过自动更新锁文件掩盖漂移。
- Electron/electron-vite/Vite/React/TypeScript 在步骤 2 结合官方 engine、peerDependencies 和生产构建验证后锁定；不能把候选 Node 版本视为全部依赖兼容证据。后续模块按需引入 PDF.js、编辑器、检索等依赖。
- 每次新增依赖同时检查许可、Windows wheel/打包资源、安装脚本与运行需求；测试依赖与发布依赖分组。若需更换技术路线先提出 issue，再由用户决定。
- 步骤 2 在功能编码前验证解释器显式路径、虚拟环境、依赖安装/导入、Node 与构建工具最小运行；本机 uv 缓存权限问题优先用有写权限的项目缓存目录处理并复测，不以管理员权限或切换全局 Python 作为默认解决办法。
- 必须在打包的 Python 中再次确认 SQLite/FTS5 可用，不能拿系统解释器探针替代发布验收。

官方依据（2026-10-22 核查）：[electron-vite 前置要求](https://electron-vite.org/guide/)、[pnpm 锁文件安装](https://pnpm.io/cli/install)、[uv 锁定与同步](https://docs.astral.sh/uv/concepts/projects/sync/)、[SQLite 外键规则](https://www.sqlite.org/foreignkeys.html)。实际安装时再次核查版本和许可证。

## 6. 待验证事项与交接门槛

| 事项 | 当前结论 | 处理步骤与通过证据 |
| --- | --- | --- |
| 视觉方向 | 用户已选方案三，保留 Storage/Garden/House 名称；设计 review 已通过，运行验证待实现 | 1：统一设计说明与名称修订稿 |
| 工具链 | Python 3.12.10 可直接运行；用户确认普通终端 uv 枚举通过，沙箱缓存权限待处理，未确认阻塞项目开发；未安装应用依赖 | 2：环境检查记录、锁文件及最小构建 |
| 密钥/进程/分发 | 仅定义方案 | 2、4、14：安全保存与恢复、子进程启停、干净 Windows 实测 |
| 真实模型与预算 | 用户自带 API；服务商/型号尚未实测 | 4：用户安全配置与短文本连接测试，分别验证 chat/embedding |
| PDF 与跨语言检索 | 尚无固定样例实测 | 5、8：合法样例清单、摘要、证据页码与 PLAN 的 12 问记录 |
| 修订与来源 | 数据和接口约定已定义，尚无运行代码 | 9–12：真实引用流转、删除失效、冲突/回退测试 |
| 干净 Windows | 尚未落实 | 14 前落实测试机/VM；无验证则不宣称发布通过 |

本步交付边界是“范围、目录、数据与接口可评审，迁移/锁定方案明确，待验证项有归属”。用户通过本步后才能进入步骤 1；设计步骤整体确认后才合并设计分支。本文不授权安装依赖、自动进入下一步或自动合并。

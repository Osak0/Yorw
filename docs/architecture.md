# 当前架构与数据约定

适用 v0.2.0 / schema 11。这里描述现役代码；环境和复现命令见[开发指南](development.md)，历史取舍见[开发记录](history/v0.2.0.md)。

## 模块与通信

```text
React renderer → 受限 preload IPC → Electron main → 本地 FastAPI → SQLite / PDF / 模型服务
```

| 位置 | 实际职责 |
| --- | --- |
| `apps/desktop/src/main/` | 窗口、原生对话框、safeStorage 密钥、Python 生命周期、业务 IPC 校验与转发。 |
| `apps/desktop/src/preload/`、`src/shared/` | 固定桥接操作和手写 TypeScript 合同；变更时与 Python DTO 同步。 |
| `apps/desktop/src/renderer/` | Storage/Garden/House、PDF.js、CodeMirror、Markdown 预览及会话内草稿。 |
| `services/api/src/yorw_api/` | 按业务文件组织 FastAPI/Pydantic、有限并发任务、模型协议和持久化。未建立早期规划中的空 `api/services/prompts` 分层。 |
| `storage/`、`migrations/` | 受管路径、SQLite 事务、完整性检查和顺序迁移。 |
| 两侧 `tests/`、`scripts/` | 自动化回归、构建、自编写样例生成及完整桌面复现。 |

main 启动 Python 时通过 stdin 传入工作区与会话令牌；后端监听 127.0.0.1 动态端口，HTTP 使用 Bearer 会话认证。健康握手成功才进入 ready。renderer 保持 contextIsolation/sandbox，关闭 Node 集成，IPC 检查来源窗口、mainFrame 和 URL；不开放任意路径、HTTP 或命令执行。

开发使用独立的 `Yorw-development` profile；正式运行使用 Electron userData。实际路径由 House 显示。工作区含 `yorw.sqlite3`、`documents/<uuid>.pdf`、`tmp/`、`logs/`、`backups/`；main 另管 `secrets/`，密钥不进数据库或普通日志。测试 profile 和数据位于报告目录，不使用真实用户库。

## 数据所有权与一致性

- UUID 为业务 ID，时间为 UTC，物理页码从 1 开始。导入保存受管 PDF 副本并按 SHA256 去重；原始文件不会因应用移除文献而删除。
- `documents/chunks` 保存文献元数据、抽取版本、页文本和阅读页码；`notes` 保存文献笔记及来源；`conversations/messages` 保存问题、输出、状态、来源和提示词/模型信息。
- `topics` 管层级与当前修订指针；`revisions` 是不可变正文/来源快照；`suggestions` 独立保存生成草稿、基础修订、材料与请求；`wiki_decisions` 保证采纳、拒绝与回退幂等。
- `tasks` 持久化任务状态与进度；`provider_configs` 保存版本化地址和模型名，不保存 key；`ai_preferences/ai_requests` 保存检索偏好和一次输入的幂等请求。
- 旧 `search_documents/search_segments/index_generations/embeddings` 与新 `knowledge_sources/knowledge_segments/knowledge_vectors/knowledge_fts` 均为派生检索数据；原始页文本、修订及来源快照继续是权威记录。
- 当前 schema 由 001–011 迁移组成。升级已有库前用 SQLite backup API 备份；逐迁移事务、外键及完整性检查；校验历史 checksum，拒绝较新数据库。不要修改已应用 SQL。写入经 RLock 与短事务串行化，网络请求不占写事务，启用 WAL 和 busy_timeout。
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

## 导出与扩展边界

内容导出在同一数据库锁内创建快照，ZIP 的 Markdown 与已保存正文一致，来源独立列入清单；main 通过系统对话框保存，临时文件加 rename。没有完整工作区恢复、云同步或外部 Markdown 双向同步。

旧检索/选材 API 保留兼容；现役界面走统一工作流。PDF 当前用可替换的 pypdf 文字抽取，无 OCR、图像观察或复杂版面理解。扩展先依据失败案例验证，不以增加 Skill/插件替代来源与数据合同。

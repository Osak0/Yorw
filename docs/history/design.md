# 设计与最初实施约定（历史归档）

2026-10-26 整理，来源为 Git `2c31cae` 中的原始文档。下文保留当时的状态、命令、失败与验证结论，**不作为现役功能或发布状态**。当前说明从 [README](../../README.md)、[PLAN](../../PLAN.md)、[开发指南](../development.md)进入。仅迁移标题层级与本地链接，原文可用 `git show 2c31cae:<原路径>` 恢复。

<a id="product-design"></a>

## 原记录：`product_design.md`

原文件 SHA256：`13995e5ca76e7368de88ef3f5200626b42db565db38e368cee8920cbde7193b0`。

### 知栖 Yorw：产品设计与实施计划输入

版本：v1 · 更新日期：2026-10-22

状态：产品设计基线，尚未开始应用实现。本文记录产品需求、架构选择、首版范围和验收原则，供后续 Agent 在计划模式中制定可执行计划；本文不是实现结果，也不是原始开发对话。

#### 1. 产品背景与目标

Yorw（Your own research workplace）是面向科研学习者与研究人员的本地优先知识工作区。它连接文献阅读、AI 讨论、笔记和专题 Wiki，让围绕研究问题形成的理解能够持续积累、回查和修订。

首批目标用户是持续阅读一个研究方向论文的学生和个人研究者。待验证的问题是：材料、笔记和 AI 对话分散，使已有认识难以在后续研究中复用。当前没有用户访谈、实测节时数据或效果承诺。

核心价值不是增加一个独立聊天框，而是让阅读时的原文、讨论形成的认识和 Wiki 更新在同一工作区连贯流转。保留用户已有判断，区分原文事实、用户观点和模型推断。

#### 2. 产品结构

##### Storage：文献与学习过程

- 文献区域支持列表、基础信息卡、PDF 阅读和笔记；右侧 AI 对话面板可隐藏，并可调整工作区宽度。
- 每篇论文生成基础可编辑信息卡，建议字段为标题、作者、年份、研究问题、方法和关键认识；不确定的元数据可为空，不允许凭空补齐。
- 对当前论文提问，回答携带证据片段和引用页码，可返回原文查看。
- 对话和笔记与对应文献关联保存；用户可以选择内容作为 Wiki 的材料。
- 学习记录首版为阅读、提问、保存笔记、采纳 Wiki 更新的简单时间线，不推断用户已经掌握某个概念。

##### Garden：专题 Wiki

- 左侧为以知识专题组织的层级目录和正文工作区，右侧是可隐藏的 AI 对话面板。
- 用户可创建、编辑、保存主题页；LLM 可根据用户选定的文献、笔记和讨论生成草稿或修改建议。
- AI 修改先展示预览，再由用户确认；已有内容可查看修订和回退，不能静默覆盖。
- 每个主题页保留来源关联，支持回查原文；主题问答应明确当前使用的材料范围。
- 文档、思维导图、词云是同一知识内容的不同视图。首版实现文档，其他视图后续扩展，不分别维护三套知识内容。

##### House：个人主页与设置

- 本地个人资料和研究主题。
- 模型连接设置、连接状态及清楚的错误反馈。
- 数据存储位置、内容导出和必要的本地工作区信息。
- 首版不做在线账号、登录和多人权限。

#### 3. 首个 MVP

必须完成的真实流程：

**导入 PDF → 阅读并进行带来源的问答 → 保存笔记 → 从选定材料生成 Wiki 草稿 → 用户确认保存 → 重启应用后继续读取和编辑。**

| 模块 | 首版必须提供 | 后续再评估 |
| --- | --- | --- |
| Storage | 文本 PDF 导入与阅读、基础信息卡、笔记、问答和引用、对话保存、简单事件时间线 | 复杂标注、联网抓文献、自动分类、自动学习分析 |
| Garden | 层级主题、Markdown 编辑、选定来源生成草稿、预览确认、修订回退、复用主题对话 | 思维导图、词云、拖拽图谱、自动全库更新 |
| House | 本地资料、研究主题、模型设置、数据位置与导出 | 云同步、多用户、付费和复杂统计 |
| 底层 | 小库 RAG、显式可编辑记忆、任务进度和失败反馈 | 隐式自动记忆、自主多 Agent、本地大模型部署 |

初期以 5–10 篇可提取文字的 PDF 验收。不承诺扫描件 OCR、公式/复杂表格理解、图像证据识别和精确坐标标注；引用首版到页并展示片段。解析不佳时必须报告问题，不把错误抽取当成完整原文。

#### 4. 技术基线与职责

| 部分 | 选型 | 职责 |
| --- | --- | --- |
| 平台 | Windows x64 优先 | 首版运行与发布验收目标 |
| 桌面与构建 | Electron + electron-vite | 窗口、文件交互、受限桌面能力、Python 服务生命周期 |
| 前端 | React + TypeScript | 三个页面、共享工作区和类型明确的交互 |
| 视觉组件 | Tailwind CSS + shadcn/ui + Lucide | 统一主题、多栏、空状态、错误和进度反馈 |
| 状态 | TanStack Query + 少量 Zustand | 服务数据与界面状态分开管理 |
| 后端 | Python 3.12 + FastAPI + Pydantic + Uvicorn 单进程 | API、文献业务、存储、检索、模型工作流 |
| PDF | PDF.js + pypdf | 前端阅读和跳页；后端按页抽取文本，解析器独立封装 |
| 编辑 | CodeMirror 6 + Markdown 预览 | 笔记与 Wiki；公式支持按需加入 KaTeX |
| 存储 | Python sqlite3 + SQL 迁移 + 本地文件 | 正文、修订、元数据、对话、任务和索引；PDF/附件独立保存 |
| RAG | SQLite FTS5 + 多语言 embedding + NumPy | 小库关键词/语义检索、来源追溯 |
| 模型 | 一个可替换 provider 接口 | 流式对话、结构化信息卡、Wiki 建议和上下文摘要 |
| 任务 | SQLite 状态 + 有限并发执行 | 导入、抽取、索引、卡片生成的进度和失败恢复 |
| 依赖 | pnpm、uv 与锁文件 | 在兼容性验证后锁定具体版本 |
| 测试与发布 | Vitest、pytest；PyInstaller onedir + electron-builder | 关键逻辑、生产构建、后端资源打包和 Windows 分发 |

不预先引入 Next.js/SSR、Rust/Tauri、Docker 必需运行环境、独立向量服务、图数据库或复杂 Agent 框架。技术接口保留扩展空间，具体库版本在实施时检查，不宣称当前已经兼容。

PyMuPDF 不作为默认解析依赖。若 pypdf 在代表性论文上效果不足，应比较替代实现及许可证后决定；通过解析接口替换，不推倒重做应用。

#### 5. 架构与数据所有权

通信路径：**React renderer → 受限 preload IPC → Electron main → 本地 Python HTTP 服务和流式事件。**

- Electron 管理服务启动握手、健康检查、关闭回收和故障日志；Python 只监听 127.0.0.1 的可用端口，使用每次启动的会话令牌。
- renderer 开启隔离与沙箱，关闭 Node 集成；preload 仅提供明确的应用操作，不暴露任意文件读写或命令执行。
- Python 集中处理业务和持久化，按 API、业务服务、存储、模型 provider 分层；前端不再实现一套并行的存储业务。
- SQLite 是笔记/Wiki 正文、元数据、对话和修订的权威存储；Markdown 是可导出格式。首版不做外部 Markdown 目录实时双向同步。
- 用户数据位于 Electron userData 的工作区，不能写进安装资源目录。导入 PDF 保存受管理的副本，计算摘要去重；升级程序不能误删用户资料。
- API key 由 Electron safeStorage 保护后保存，不进入 renderer、localStorage、Git 或普通日志。
- 本地优先指数据默认本地保存，不表示完全离线；云端 LLM/embedding 会接收所需内容。未配置模型时仍可阅读、编辑和进行可用的本地检索，AI 功能明确显示未配置。

#### 6. 核心数据对象

| 对象 | 至少需要表达 |
| --- | --- |
| Document / Card | 稳定 ID、文件摘要/版本、路径、元数据、抽取状态、可编辑卡片及来源 |
| Chunk / Citation | 文献 ID、片段 ID、物理页码、证据文本、抽取/索引版本 |
| Note | 正文、文献或主题关联、来源、创建与修改时间 |
| Conversation / Message | 所属文献或主题、消息顺序、原始文本、引用、模型与提示词版本 |
| LearningEvent | 阅读/提问/笔记/采纳等事件类型、时间、关联对象 |
| Topic / WikiPage / Revision | 主题层级、正文、来源关系、修订、生成建议及其基础版本 |
| Memory | 研究主题、用户确认的认识或偏好、摘要、来源、可编辑/删除状态 |
| Task | 类型、状态、进度、错误及重试所需的信息 |

这是逻辑对象清单，不要求每个对象独立成表或模块。实施计划需要给出最小合理 schema，避免过度拆分。

#### 7. RAG、Wiki 与 Memory 的规则

1. 文献按页/段切块并保存来源。单篇问答默认限定当前文献；主题问答明确选择的材料范围。
2. 关键词与语义结果合并后向模型提供候选证据。中文提问检索英文论文需要实际验证，多语言 embedding 型号尚未选定。
3. 向量可以与片段存入 SQLite，小库使用 NumPy 精确相似度。记录 embedding 模型和维度、chunk 版本；发生变化后重建索引。通过检索接口允许后续替换实现。
4. 引用 ID 必须来自本次实际检索结果，展示原始证据与页码。引用存在不等于语义正确，需人工评估；没有证据时明确表示无法从当前材料找到。
5. Wiki 草稿基于选定原文、笔记和讨论，不只反复总结旧 AI 摘要。说明来源事实、用户观点与模型推断。
6. AI 修改保存前检查基础修订，避免覆盖用户刚编辑的内容；保存失败不得显示成功。支持回退，保留来源关系。
7. 对话历史原样持久保存，进入长期记忆需有明确规则及用户控制。用户可以查看、编辑和删除记忆。
8. 删除文献后清理相关索引，相关 Wiki 内容提示来源失效，不能继续伪装为可回查证据。
9. 文献内容是待处理资料，不能作为指令触发任意工具、泄露密钥或自动改变工作区。

#### 8. 视觉与交互原则

- 简洁、安静、适合长时间阅读，内容层级清楚，避免过度装饰和无必要动效。
- Storage 与 Garden 复用导航、面板、对话、来源展示和任务状态；切换后合理保留选择与未完成草稿。
- 面板可隐藏、可调宽；长文阅读与编辑空间优先。加载、流式生成、取消/重试、空状态和错误反馈要明确。
- 整体视觉方向尚未选择。开始界面实现前需完成视觉方案选择，不凭本文直接宣称已有设计稿。
- 后续图谱和词云服务于查找与理解，不以增加视觉元素代替真实功能。

#### 9. 实施阶段与验收门槛

- 第一阶段整体开发时间在3~5天，完成MVP版本；后续时间较充足，可进一步持续开发，完善应用

| 阶段 | 内容 | 验收门槛 |
| --- | --- | --- |
| 0. 计划与设计 | 检查仓库规则、现有变更与工具链；选择视觉方向；定义接口/schema和可执行任务 | 输出可评审计划和明确范围；没有实现前不声称完成 |
| 1. 工程与发布基础 | 桌面、Python 服务、SQLite、最小界面、受限通信 | 可启动、写入并重启读取；尽早验证生产包中的 Python 启动 |
| 2. Storage | PDF 导入、阅读、卡片、笔记 | 真实样例可读可写，异常和解析失败可见 |
| 3. RAG 与记录 | 检索、模型对话、引用、聊天保存、简单事件记录 | 回答使用实际来源，引用可跳页，重启后消息仍在 |
| 4. Garden 与 House | 主题编辑、草稿、修改预览/确认/回退、显式记忆和最小设置 | 论文与讨论能流转为带来源的主题知识，用户可修订 |
| 5. 稳定性与发布 | 连续流程、失败恢复、干净环境、构建产物、说明与演示 | 安装后的程序完成核心流程，无开发环境依赖遗漏 |

若进度不足，先缩减卡片字段、学习记录的展示复杂度、动效及扩展视图，保住核心流程。不能只留下三个静态页面或用预置答案代替真实模型与检索。

#### 10. 工程记录与文档，Agent行动规则

- 所有源码、测试、构建配置、项目文档和发布材料位于 Yorw 仓库。私有工作日志与个人数据不进入仓库；示例资料需可合法使用。
- 在方案确定之后，实际实践开始之前，请你优先确保开发环境正常，避免因为环境问题导致bug。
- 建议按实际需要组织 `apps/desktop/`、`services/api/`、`docs/`、`scripts/`；实施 Agent 应以清晰、可维护的最小结构为准。
- 保留依赖锁文件、数据库迁移、配置模板、模型/提示词版本及脱敏错误日志；密钥不写入源码。
- 用真实功能增量形成 Git 提交：设计文档、工程基础、Storage、RAG、Garden、稳定性等可以逐步提交，不一次塞入全部功能，不重写或伪造已有历史。
- 严格遵守 Github flow，每个模块或者功能都应在new branch上先实现，经过核验后再merge到main branch，不能一次性实现整个开发阶段或者全部功能，对于需要调整技术栈等较重要的决策，需要我介入的bug等，请你先提出issue，然后我们来解决。
- Git提交日志(关键):必须保留完整的、细粒度的Git提交历史。禁止一次性提交(”initialcommit"即包含全部功能)。每次提交应对应一次与AI的核心对话或一个功能模块的落地。
- 当我启动多个Agent开发不同功能时，需要使用工作树（如果我没有开启，记得提醒我），避免相互干扰。
- 合适的开发记录在 `docs/dev-evidence/` 整理索引，关联实际 commit；对外前去除密钥等不应公开的信息，保留原始档案和必要的脱敏说明。
- pytest / Vitest 覆盖有意义的检索、来源、持久化和修订逻辑；实际桌面验收覆盖导入、问答、Wiki、重启、网络异常、缺 key 和打包启动。
- 至少准备一组固定样例和人工可核查的问题；记录失败案例，不虚构准确率或性能数据。LLM 输出记录配置，不承诺逐字确定性。
- 说明文档应与当前真实实现一致。构建产物和大文件按需 Git 忽略，用户数据不作为默认演示资料。
- 我与Agent的对话记录将导出，用于后续复现应用。
- 先读取本文件、README 和适用的 AGENTS.md，检查当前分支、工作区与现有代码，以我的最新指令为准。先在计划模式给出阶段任务、依赖关系、验收方式、风险与范围取舍；需要我确认的核心信息集中提出。在我确认开始实施前，不安装依赖、搭建应用或擅自启动下一阶段。

#### 11. 计划阶段仍需落实

- 具体 LLM/embedding 服务商、型号、预算和连通性。
- 精确依赖版本及本机 Node/Python/pnpm/uv 工具链。
- 视觉方案、代表性样例论文、干净 Windows 验证环境。
- 在现有 LICENSE 下核查所选依赖适配性，不擅自修改项目许可证。
- 在实际时间预算中重新校准 MVP 大小；新增依赖或扩展功能必须说明必要性和交付影响。

- [开发计划](design.md#mvp-plan)：当前首版范围、分步实施与 review 验收规则。
- [README.md](../../README.md)

---

<a id="mvp-plan"></a>

## 原记录：`PLAN.md`

原文件 SHA256：`ee320ec370eade0707bced571fce114ddacc70115b8c843a54b7dad564d47640`。

### 知栖 Yorw：MVP 开发与 Review 计划

版本：v1 + v0.2.0 改进 · 更新日期：2026-10-26

状态：步骤 0–14 已通过用户 review 并合并 main。步骤 14 提交 efa63da 随 PR #12 合并（6937846）；2026-10-25 已发布 [v0.1.0 预发布版本](https://github.com/Osak0/Yorw/releases/tag/v0.1.0)，标签指向 6937846。按用户选择，干净 Windows 验收暂未执行，不宣称所有分发环境已通过。

后续改进：[v0.2.0 AI 流程计划](v0.2.0.md#plan)已由用户确认，并进一步授权在新分支持续完成全部计划后统一 review。三阶段实现位于 `feature/ai-workflow-simplification`，包含草稿恢复、统一检索、一键问答及全工作区自动选材；[完整交付与验证记录](v0.2.0.md#completion)提供当前证据。等待用户 review，未提交、合并或公开发布。真实服务质量由用户在最终 review 程序的 House 配置后验收；本机流程验证不替代真实模型或干净 Windows 评估。下文步骤 0–14 保留 v0.1.0 历史范围，v0.2.0 的后续授权与变更以上述计划和完整记录为准。

#### 1. 文档职责与接手入口

- [product_design.md](design.md#product-design) 保存产品设计基线与长期方向。
- 本文记录本轮讨论确认后的首版执行范围、步骤与验收门槛；与设计基线存在范围差异时，采用第 2 节明确列出的调整，不将后置功能自动纳入 MVP。
- [README.md](../../README.md) 面向用户介绍产品，不承载完整执行规则。
- [步骤 0 工程基线](design.md#engineering-baseline) 定义目录、最小数据模型、接口、迁移与锁定方案；[交付记录](v0.1.0.md#step-00) 区分实测证据、待验证项与用户 review 状态。
- 后续 Agent 先读取适用的 `AGENTS.md`、上述文档，检查当前分支、工作区、代码与实际验收记录；用户最新指令优先。发现未被本文解释的冲突时先提出，不自行扩大范围。
- 规划完成、代码完成、验证通过、用户 review 通过和合并是不同状态；不得因为已有文档就将对应功能标为完成。

#### 2. 产品定位与范围调整

知栖（Your own research workplace）是面向个人研究者与科研学习者的本地优先阅读与知识工作区。首版解决阅读、讨论、笔记与专题知识之间的材料流转问题，不承诺替代完整的书目管理与写作引用工具。

必须完成的真实流程：

**导入 PDF → 阅读与带来源问答 → 保存笔记 → 选择材料生成专题 Wiki → 预览确认 → 重启后继续读取和编辑。**

首版面向 Windows x64，以 5–10 篇可提取文字的 PDF 验收。3–5 天作为核心流程开发目标，不作为全部规划功能的交付保证；等待用户 review 的时间单独计入排期。

##### 相对产品设计基线的明确调整

| 项目 | 本轮确认后的执行范围 |
| --- | --- |
| 信息卡 | 首版保留基础元数据展示与人工编辑；未知字段留空，AI 完整信息卡后置。 |
| 学习记录 | 阅读、提问、笔记与采纳的时间线展示后置，不提前建设独立学习分析模块。 |
| Memory | 独立记忆管理、自动摘要入库与个性化记忆后置；对话原样保存，不能自动视为已确认认识。 |
| House | 首版完成模型设置、数据位置与内容导出；个人资料和研究主题设置后置。 |
| Garden | 首版保留专题目录、人工编辑、选材生成草稿、预览确认与修订回退；持续主题聊天后置。 |
| 模型 | 聊天与 embedding 分别配置，可来自不同服务商；不绑定平台账号或内置订阅。 |
| 导出 | 首版导出 Markdown 与来源清单；完整工作区备份、恢复和迁移工具后置，不能将内容导出称为完整备份。 |
| 工期 | 核心流程优先；若进度不足，削减展示复杂度和装饰，不削减真实来源、持久化及修改确认。 |

继续后置：OCR、复杂公式/表格理解、图像证据识别、精确坐标标注、联网抓取、自动分类、全库自动更新、图谱/思维导图/词云、云同步、多用户、付费、隐式记忆、自主多 Agent、本地大模型部署，以及 DOI/BibTeX/写作插件等完整书目工作流。

#### 3. 技术基线与实现边界

##### 3.1 技术与工程

| 部分 | 计划选型与职责 |
| --- | --- |
| 桌面 | Electron + electron-vite；管理窗口、文件交互与 Python 生命周期。 |
| 界面 | React + TypeScript、Tailwind CSS、shadcn/ui、Lucide。 |
| 状态 | TanStack Query 管理服务数据，少量 Zustand 管理界面状态。 |
| 本地服务 | Python 3.12 + FastAPI + Pydantic + Uvicorn 单进程。 |
| 阅读与解析 | PDF.js 阅读与跳页；pypdf 按页抽取，解析器独立封装。 |
| 编辑 | CodeMirror 6 + Markdown 预览，KaTeX 按实际需求再引入。 |
| 存储 | Python sqlite3 + SQL 迁移 + 本地文件；SQLite 为正文与修订的权威存储。 |
| 检索 | SQLite FTS5 + 多语言 embedding + NumPy 精确相似度。 |
| 任务 | SQLite 保存任务状态与错误，有限并发执行导入、抽取及索引任务。 |
| 工程 | pnpm、uv 与锁文件；Vitest、pytest；PyInstaller onedir + electron-builder。 |

按需要组织 `apps/desktop/`、`services/api/`、`docs/`、`scripts/`，不为未来能力预建复杂框架。不引入 Next.js/SSR、Rust/Tauri、必需 Docker 环境、独立向量服务或图数据库，也不接入远程 A800。

保持现有 MIT 项目许可证；新增依赖在引入前核对许可与兼容性。PyMuPDF 不作为默认依赖；若 pypdf 在代表性论文上不满足要求，先提出替代方案及影响，再决定是否更换。

##### 3.2 通信、数据与密钥

通信路径为 **React renderer → 受限 preload IPC → Electron main → 本地 Python HTTP 服务及流式事件**。

- Electron 管理启动握手、健康检查、关闭回收与故障日志；Python 仅监听 `127.0.0.1` 的可用端口，使用每次启动的会话令牌。
- renderer 启用隔离与沙箱，关闭 Node 集成。preload 只暴露明确应用操作，不开放任意路径读写或命令执行。
- Python 集中处理业务与存储，按 API、业务、存储、provider 分层；前端不维护另一套持久化逻辑。
- 用户资料位于 Electron `userData` 工作区，导入 PDF 保存受管理副本并以摘要去重；不写入安装资源目录，升级不能误删资料。
- API key 由 Electron `safeStorage` 保护后保存，不回传 renderer、不进入 localStorage、Git 或普通日志；模型调用所需密钥仅通过受控本地通信传给后端使用。
- Markdown 是导出格式；首版不做外部 Markdown 目录实时双向同步。

最小逻辑数据模型包含：文献及基础元数据、按页文本片段、笔记、会话与消息、专题页与修订、来源关联、任务与索引配置。专题节点与 Wiki 页面合并建模；来源引用可复用，不要求每个逻辑对象独立成表。步骤 0 固化必要字段、关联与最小迁移方案，不提前建设 Memory 或学习事件子系统。

##### 3.3 模型、检索与来源接口

- 分离 `ChatProvider` 与 `EmbeddingProvider`；各自配置 API 地址、模型名称及密钥。首版实现 OpenAI-compatible 调用路径，不承诺兼容所有厂商特有能力。
- 设置页分别测试两类连接；测试使用短测试文本，不默认上传论文。模型名可编辑，只将实际测试过的服务标记为已验证。
- 使用云端服务前明确发送范围：embedding 建索引可能发送待索引全文片段，聊天发送选定上下文。不能仅提示“发送当前问题”。
- 未配置模型时保留阅读、编辑和可用的本地检索。embedding 缺失或失效时降级为明确标注的关键词检索，不声称具备可靠跨语言召回能力。
- 文献按页/段切块；关键词与语义检索合并候选证据。FTS5 默认分词不承担跨语言匹配能力，中文提问检索英文论文必须实测。
- 记录 embedding 模型、维度和分块/抽取版本；版本改变后重建对应索引，不混用不兼容向量。
- 单篇问答限定当前文献；Wiki 生成限定用户明确选定的材料。无依据时说明当前材料中未找到答案。
- 引用保留文献 ID、片段 ID、物理页码、原始证据和抽取版本；回答引用 ID 必须来自本次实际提供的证据。引用存在不等于语义正确，仍需人工核查。
- 保存到笔记并进入 Wiki 的引用保留原始文献关系，不将上一轮 AI 回答当成论文原文。生成时区分原文事实、用户观点和模型推断。
- 流式事件区分文本增量、引用、完成、取消与失败；中断回答保留明确状态，不显示为生成成功。
- 删除文献时清理索引；保留的笔记/Wiki 标记对应来源失效，不伪装为仍可回查。
- 文献正文始终作为资料处理，不得据其内容触发任意工具、泄露密钥或自动改变工作区。

##### 3.4 界面与编辑规则

- 导航固定使用 **Storage / Garden / House**，大小写保持一致。这是产品文化的一部分，不得替换为“文献 / 专题 / 设置”，也不添加这些通用名称作为导航前缀；功能含义在 README、帮助或引导中说明。采用用户选定的方案三：顶部导航、蓝色主题，以长时间阅读为主。
- 进入文献后允许收起列表；PDF 为主区域，笔记与聊天共用可切换、可隐藏、可调宽的侧栏。
- Garden 使用专题目录、正文与按需展开的 AI 建议区；“选择材料 → 生成建议 → 比较确认”有明确状态。
- 切换页面保留当前文献、阅读位置和编辑草稿；保存失败保留草稿，不能提示保存成功。
- AI 建议携带基础修订 ID；确认时若正文已变化，要求重新比较或生成，不静默覆盖。回退创建新修订，并恢复对应来源关系。
- 在界面实现前完成三套视觉方向的评审与选择；没有设计稿或运行验证时不得宣称视觉验收通过。

#### 4. 分支、Review 与交付规则

设计阶段使用 `design/product-design`，规划和步骤 0–1 已完成 review 并合并 main。后续实施遵守下面的分支与逐步 review 规则；用户明确授权合并交付时按该次授权执行。

设计分支合并后，每个功能从最新 `main` 新建独立分支，按用户当前约定命名 `feature/<功能名>`。顺序为：

**确认本步范围 → 新建分支 → 实现一个功能/模块 → 验证 → 交付用户 review → 明确通过后合并 → 再进入下一步。**

- 开发环境前置检查：方案确定且用户确认开始实施后，先验证开发环境，再编写应用功能。检查 Node、pnpm、Python 3.12、uv 的实际路径与版本、独立 Python 环境、依赖安装/解析及当前步骤所需工具的最小运行；记录命令、版本、结果和问题。环境未通过时先排查，不带着已知环境问题推进功能。新增依赖、更换机器或运行环境后，复查受影响项；不能将检查通过解释为保证没有 bug。用户未确认实施前，仅做只读检查，不安装依赖或搭建应用。
- 每一行步骤都是独立交付单元，不得一次连续实现整个阶段或全应用；某步通过不等于后续所有步骤自动获批。
- 用户要求修改时继续当前步骤，更新验证结果，重新交付 review。
- 保留真实、细粒度 Git 提交；不重写、伪造历史，不用一个提交覆盖整个项目开发过程。
- 重要技术栈变更、范围调整或需用户决策的问题先提出 issue，说明证据、影响和方案；不借机扩大实现范围。
- 仅在用户启动多个 Agent 开发时使用独立 worktree；未开启时提醒用户，避免共享工作区互相覆盖。
- 开发证据在 `docs/dev-evidence/` 按需建立索引，关联实际 commit、关键对话、错误与验证结果；公开前脱敏。个人数据、大文件和密钥不进入仓库。

每步交付应包含：本步范围与结果、可操作的验收入口、验证记录与已知问题、diff/commit、用户需检查的行为。接手 Agent 根据实际代码与记录更新状态，不能仅凭前一轮口头描述认定完成。

#### 5. 分步实施与验收

默认串行推进；下表依赖表示功能上的前置条件，不授权跳过尚未 review 的步骤。

| 步骤 | 功能边界与交付物 | 功能依赖 | 验收标准 |
| --- | --- | --- | --- |
| 0 | 设计基线与工程约定：确认范围、目录、最小数据模型、接口、迁移及依赖锁定方案。 | 本计划及现有设计文档 | 处理范围差异和现有变更；接口/schema 可评审，待验证事项有处理步骤；不声称应用已实现。 |
| 1 | 视觉方向：三套同一阅读工作区方案，选定导航、字体、色彩、面板和状态样式。 | 0 | 用户选定视觉方向；没有选定前不开始界面实现。 |
| 2 | 桌面运行与打包骨架：先准备并验证开发环境，再实现 Electron 启停 Python、健康检查、受限通信、故障提示。 | 0–1；设计分支完成 review 并合并；用户确认开始实施 | 编写应用功能前完成环境检查并记录结果；开发环境与最小打包程序均能启动后端、关闭回收；启动失败有可诊断提示。 |
| 3 | 本地工作区：SQLite 迁移、数据目录、受管理文件存储。 | 2 | 写入后重启可读取；迁移和启动中断不误删已有资料；用户数据不进入安装目录。 |
| 4 | House 模型设置：聊天与 embedding 独立配置、安全保存、连接测试。 | 3 | 至少验证一组真实服务；缺配置、鉴权和网络失败可见；不在界面或日志泄露密钥。 |
| 5 | Storage 导入与列表：PDF 副本、摘要去重、按页抽取、任务状态、基础元数据编辑；提供删除入口并处理关联来源状态。 | 3 | 重复、损坏、加密和无文本 PDF 有明确反馈；未知元数据不编造，重启后文献仍可访问；删除不会留下可检索的失效材料。 |
| 6 | Storage 阅读器：打开 PDF、翻页、缩放、记住位置。 | 5 | 真实样例可读；重启恢复位置；解析不足的文件可阅读但明确其 AI 能力限制。 |
| 7 | Storage 笔记：Markdown 编辑、预览、保存和草稿保护。 | 6 | 切换文献和重启后保存内容正确；保存失败不丢失当前草稿。 |
| 8 | 检索模块：分块、关键词/向量索引、文献范围过滤与重建。 | 4–5 | 固定中英文问题能检查真实召回；索引版本一致；删除文献后索引清理；失败或未配置时降级状态清楚。 |
| 9 | Storage 问答：流式回答、取消/重试、聊天持久化、证据片段与跳页、回答转笔记。 | 4、6–8 | 使用实际提供的来源；引用可跳正确页；笔记保留原始引用；中断状态和重启后的消息正确。 |
| 10 | Garden 目录与编辑：创建、重命名、调整父级、Markdown 编辑和人工保存修订。 | 3、7 | 防止目录循环；专题和修订重启后可读，编辑失败不伪报成功。 |
| 11 | Garden 选材与草稿：从选定论文、笔记和对话生成建议。 | 8–10 | 展示材料范围；原文依据可追溯，区分观点与推断；生成草稿不直接覆盖正文。 |
| 12 | Garden 确认与回退：对比正文和建议、编辑后确认或拒绝、冲突检查、修订回退。 | 11 | 确认前不覆盖；旧基础版本不能覆盖新编辑；回退生成新修订并恢复来源关系。 |
| 13 | House 数据与导出：显示数据位置，导出笔记/Wiki Markdown 及来源清单。 | 7、12 | 导出内容与已保存内容一致，来源清晰；明确不包含完整工作区备份与恢复能力。 |
| 14 | 完整流程与分发验证：安装包、连续流程、故障恢复、使用说明、已知限制与开发证据索引。 | 2–13 | 安装后跑通核心流程；重启和异常场景通过检查；在无预装 Node/Python 的 Windows 环境验证启动。 |

步骤 2–12 是核心流程的主要实现路径，13–14 完成首版导出与发布验收。早期打包试验在步骤 2 完成，不能全部推迟到发布末尾。

##### 执行状态清单

以下“未实施”指步骤尚未完成其交付与 review，不否认已经形成的规划文档。状态建议依次为：未实施 → 进行中 → 待 review → review 通过 → 已合并；设计步骤记录对应评审与设计分支合并结果。

- [x] 0. 设计基线与工程约定 — 2026-10-22 用户 review 通过，已随设计分支合并；[工程基线](design.md#engineering-baseline) / [验证记录](v0.1.0.md#step-00)
- [x] 1. 视觉方向 — 2026-10-23 用户 review 通过，已随设计分支合并；采用方案三，正式名称为 Storage / Garden / House；[统一设计说明](design.md#ui-design) / [验收记录](v0.1.0.md#step-01)
- [x] 2. 桌面运行与打包骨架 — 2026-10-23 用户 review 通过，env_verify 已合并；环境与启动骨架验证见 [步骤 2 记录](v0.1.0.md#step-02)
- [x] 3. 本地工作区持久化 — 2026-10-23 用户 review 通过；feature/local-workspace；[PR #3](https://github.com/Osak0/Yorw/pull/3)；[验收记录](v0.1.0.md#step-03)
- [x] 4. House 模型连接设置 — 2026-10-23 用户 review 通过，确认 DeepSeek 接入及平台用量请求；embedding 已在步骤 8 通过用户 review；[PR #4](https://github.com/Osak0/Yorw/pull/4)（合并状态以 PR 为准）；[记录](v0.1.0.md#step-04)
- [x] 5. Storage PDF 导入与文献列表 — 2026-10-23 用户 review 通过，已合并 main（0d7e2ba）；feature/pdf-library；[记录](v0.1.0.md#step-05)
- [x] 6. Storage PDF 阅读器 — 2026-10-23 用户 review 通过，已合并 main（d57df53，PR #6）；[记录](v0.1.0.md#step-06)
- [x] 7. Storage 文献笔记 — 已合并 main（152f04e，PR #7）；[记录](v0.1.0.md#step-07)
- [x] 8. 文献检索模块 — 2026-10-23 用户 review 通过；feature/document-search；已确认智谱 embedding-3 接入、自定义语义阈值、直接检索入口及“关键词命中 OR 语义达到阈值”的并集规则；已合并 main（0abed38，PR #8）；[记录](v0.1.0.md#step-08)
- [x] 9. Storage 带来源问答 — 2026-10-24 用户 review 通过；feature/document-chat；用户截图确认 deepseek-flash 带引用回答及转笔记，已合并 main（82cb6c1，PR #9）；[记录](v0.1.0.md#step-09)
- [x] 10. Garden 专题目录与编辑 — 2026-10-24 用户 review 通过；feature/garden-editor；目录、Markdown 编辑、人工修订与只读历史完成，已提交 9b42842，后随 PR #10 合并 main（fa97a09）；[记录](v0.1.0.md#step-10)
- [x] 11. Garden 选材与 AI 草稿 — 2026-10-24 用户 review 通过；按用户授权沿用 feature/garden-editor，基于 9b42842；选材预览、独立建议草稿及来源快照完成，提交 d05ceba 后随 PR #10 合并 main（fa97a09）；用户未单独提供模型质量量化结果；[记录](v0.1.0.md#step-11)
- [x] 12. Garden 修改确认与回退 — 2026-10-24 用户 review 通过；feature/wiki-review-export；建议比较/编辑/采纳/拒绝、基础版本冲突检查与历史回退为新修订完成；与步骤 13 按用户授权合并交付，已提交 5bd8533 并随 PR #11 合并 main（3fb4860）；[记录](v0.1.0.md#step-12)
- [x] 13. House 数据位置与内容导出 — 2026-10-24 用户 review 通过；feature/wiki-review-export；工作区位置、已保存笔记/Wiki 选取、Markdown 与来源清单 ZIP 导出完成，已提交 5bd8533 并随 PR #11 合并 main（3fb4860）；不含完整备份/恢复/迁移；[记录](v0.1.0.md#step-13)
- [x] 14. 完整流程与分发验证（本机交付范围）— 2026-10-25 用户 review 通过；feature/mvp-release-validation；本机 MVP 安装包、连续流程/故障恢复及使用文档完成，提交 efa63da 随 PR #12 合并 main（6937846），v0.1.0 已发布为预发布版本；用户选择暂不提供干净 Windows 环境，独立机器与真实代表性论文逐题质量评估仍单列待验证；[记录](v0.1.0.md#step-14)

更新清单时附上交付记录、验证证据、review 结论及实际 commit/PR；不预填不存在的链接或结果。

#### 6. 验证方案

##### 固定样例与模型评估

- 先选择 5 篇可合法使用的文本论文，覆盖英文双栏、长文和中英文材料；核心流程通过后扩展至 10 篇。固定文件摘要与版本，个人未授权资料不作为默认公开演示样例。
- 固定 12 个可人工核查的问题：中文问英文论文 4 个、英文检索 2 个、无答案 2 个、跨文献干扰 2 个、依赖图表/图像而超出首版文本能力 2 个。
- 为每个问题记录允许使用的文献范围、预期原文证据和页码，或预期的无依据/能力限制说明。样例与证据准备完成前不声称已通过评测。
- 分开检查是否召回证据、回答是否受证据支持、引用页码是否正确；记录失败案例，不编造准确率或用“有引用”代替答案正确。
- 人工抽查双栏阅读顺序及证据片段。能抽出文字不代表原文结构可靠；解析不足必须可见。
- 保存服务商、模型、提示词版本、相关参数、输入输出及人工判断；记录真实模型结果，不以预置答案冒充，不要求输出逐字确定。

##### 必要自动化与桌面检查

| 层级 | 验证重点 |
| --- | --- |
| pytest | 检索范围、引用 ID 校验、持久化、索引版本、删除后来源状态、修订冲突与回退。 |
| Vitest | 流式完成/取消/失败状态、草稿保护、AI 建议确认与保存反馈。 |
| 桌面实测 | 重复导入、损坏/加密/空文本文件、缺 key、错误 key、断网、Python 服务退出、重启恢复、内容导出。 |
| 发布实测 | 在安装后的程序中完整操作；在无预装 Node/Python 的 Windows 环境检查后端启动及资源路径。 |

测试随相应步骤实现；步骤 14 汇总集成与分发验证。纯文档调整只做内容、链接与 diff 检查，不为低风险文字变动额外建设测试框架。

#### 7. 风险、待验证事项与停止条件

| 事项 | 处理时点与边界 |
| --- | --- |
| 工具链与精确依赖 | 已确认 Python 3.12.10 可运行且 SQLite/FTS5 探针通过；用户反馈普通终端 `uv python list --only-installed --offline` 通过。步骤 2 使用项目缓存验证 uv、独立环境、依赖安装、桌面构建与本机打包启动，见步骤 2 记录；干净 Windows 验收仍属步骤 14。 |
| Electron/Python 分发 | 步骤 2 先验证最小打包启动；失败先定位或提出技术调整，不拖到最终发布。 |
| 视觉方案 | 方案三及 Storage/Garden/House 正式名称已通过用户 review，见[统一设计说明](design.md#ui-design)；业务交互与无障碍仍待各功能实现验证。 |
| LLM/embedding 服务 | 步骤 4 用户确认 DeepSeek 真实接入及平台用量请求；embedding 已选智谱 embedding-3，用户截图已确认步骤 8 真实语义索引就绪（2048 维），最终检索规则及自定义阈值已获用户 review 通过；默认阈值未作通用模型校准，不能推广为语义质量基准。预算、模型语义效果与未测试厂商兼容性不因连接成功自动通过；不索要聊天中的明文密钥。 |
| PDF 抽取质量 | 步骤 5 用代表性样例检查；不能将错误抽取当成完整论文。更换解析器前说明许可、效果与交付影响。 |
| 中文问题检索英文论文 | 步骤 8 已有智谱真实样例与用户 review；0.50 初始阈值可能过滤跨语言候选，支持自定义调整。5–10 篇代表性论文及逐题效果统计仍待后续集成验收，不预填准确率。 |
| 来源与修订完整性 | 步骤 9 引用传递及失效机制已验证并通过 review；步骤 11 已通过 review；步骤 12 修订引用、并发编辑冲突与回退本地验证完成，并于 2026-10-24 通过用户 review；出现伪来源或覆盖用户编辑时先修复，不进入下一步。 |
| 干净 Windows 验证环境 | 2026-10-25 用户选择“暂时没有，先交付本机验证版”；干净机器验收暂未执行。已执行的本机受限 PATH 验证不替代干净 Windows，不能宣称所有分发环境通过。 |
| 时间预算 | review 等待单独计时；时间不足先削减展示复杂度和后置功能，不跳过来源、持久化、确认与关键验证。 |

计划不包含自动发布、自动合并或无人监督连续开发授权。步骤 0–14 的本轮交付均已通过 review，步骤 14 仅涵盖已确认的本机范围；用户已完成提交、合并 main 并发布 v0.1.0 预发布版本；当前等待进一步体验验证与改进指令。后续改进基于体验反馈另行确认，不自动扩大 MVP 范围。

- [产品设计](design.md#product-design)：产品理念与设计基线。
- [README.md](../../README.md)

---

<a id="engineering-baseline"></a>

## 原记录：`docs/engineering-baseline.md`

原文件 SHA256：`3e1042b1d8a69c9a300a4562f008cd360b9bce04822a01dd0247cb814db8abd3`。

### 步骤 0：工程与数据基线

日期：2026-10-22 · 状态：步骤 0 已通过用户 review，设计分支已合并；本文保留设计约定，实际实现进度见 PLAN 与各步骤验收记录。

2026-10-26 更新：v0.2.0 在已授权的三项改进范围内替代下文历史交互约定。搜索、问答和草稿统一经 `ai_workflows.py` 准备材料；不再要求逐次确认费用、人工建索引或勾选证据。默认语义检索由 House 全局控制，后台结合 BM25、向量、RRF 和聊天模型候选筛选；无语义配置或关闭后可回退本地关键词。问答以最近 4 轮对话理解追问，重新从当前文献找依据；历史本身不成为原文证据。Garden 全工作区自动选材，生成独立可编辑草稿，人工追加/替换后形成修订。详见[计划](v0.2.0.md#plan)与[完整验证记录](v0.2.0.md#completion)。

新增迁移 010、011，schema 9→11；保留旧页文本、索引及来源快照协议，新知识索引属于可重建派生数据。来源修改、删除、重新抽取与 Wiki 修订切换立即使相应派生索引失效。任务和 request_id 持久化，后台查询可取消，交接到流式生成先发布结果再派发，防止失败重试额外产生模型请求；前端只能调用固定 IPC，密钥仍由 main 安全读取并经私有请求头传入后端，不进入 renderer 或持久化任务。长 Wiki 的上下文有界，但不可变原始基线完整保留；追加合并原始来源并重新编号，版本校验与回退保持有效。

本文落实 [PLAN.md](design.md#mvp-plan) 步骤 0。范围以 PLAN 的首版调整为准；[产品设计](design.md#product-design) 保留长期愿景。本文定义实现约定，下表兼有已落地项与后续规划；实际数据库/API 范围以各步骤记录为准。环境实测、限制与验收索引见 [步骤 0 记录](v0.1.0.md#step-00)。

#### 1. 范围与设计决定

首版仅实现个人本地工作区：PDF 导入/阅读、基础元数据、笔记、单篇问答、选材生成 Wiki、确认/修订/回退、内容导出。按 PLAN 后置完整 AI 信息卡、时间线、Memory、个人资料、持续主题聊天和完整备份恢复。所有规划均不等于已验证的产品能力。

- 保留 Electron/React/Python/SQLite 架构；不因本机默认 Python 为 3.13 更换 Python 3.12 基线。
- SQLite 管正文与历史，文件系统管 PDF；不用 Markdown 双向同步。这样无需解决两套正文源之间的冲突。
- 主题节点与 Wiki 页面合一；正文只存在修订快照中，页面指向当前修订，避免两份正文漂移。
- 引用随内容保存不可变快照，同时保留原始 ID。重建索引、删除文献后仍可解释旧结论的出处，但必须显示来源状态。
- 聊天和 embedding 独立配置。先验证一组真实服务，不预建多个厂商 SDK、自动路由或 Agent 框架。
- 仅添加到相应步骤需要的依赖；步骤 1 已选方案三（顶部导航、蓝色主题），见[统一设计说明](design.md#ui-design)。全局入口固定命名 Storage、Garden、House，不得替换为通用名称；本步不创建界面或应用骨架。

#### 2. 目录与职责

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

#### 3. 最小数据模型

通用规则：业务 ID 为 UUID 字符串；时间为 UTC ISO 8601 字符串；物理页码从 1 开始；SQLite 布尔为 0/1。`?` 表示可空，`JSON` 是经 Pydantic 校验后保存的 TEXT。除表中明确的复合键外，`id` 为主键；可编辑实体使用递增整数 `version`，写入携带旧版本。所有连接显式启用外键。

| 表/对象 | 最小字段与约束 | 首次落地步骤 |
| --- | --- | --- |
| schema_migrations | version INTEGER PK、checksum、applied_at；禁止改写已应用迁移 | 3 |
| documents | id、sha256 UNIQUE、relative_path?、original_name、title?、authors_json、year?、metadata_source_json、page_count?、extraction_status、extraction_version、active_index_generation?、last_page、version、created_at、updated_at、deleted_at? | 5 |
| chunks | id、document_id FK、extraction_version、ordinal、physical_page、text；UNIQUE(document_id, extraction_version, ordinal)；页码必须为正 | 5；步骤 8 加检索索引 |
| notes | 步骤 7 已落地 id、document_id FK、body_md、sources_json、version、created_at、updated_at；当前仅关联文献。步骤 10 专题正文独立存入 revisions，不创建未使用的 topic_id 或专题附属笔记接口 | 7 |
| conversations | id、document_id FK、created_at；首版每篇文献一个会话，document_id UNIQUE | 9 |
| messages | 步骤 9 已落地：id、conversation_id FK、question、body_md、status、error_code、sources_json、provider_json（含提示版本）、created_at、note_id FK；一条记录保存一次问题和助手输出，取消/失败保留部分正文 | 9 |
| topics | id、parent_id? 自引用 FK、title、current_revision_id?、version、created_at、updated_at；父子关系不能形成环 | 10 |
| revisions | 步骤 10 已落地 id、topic_id FK、ordinal、body_md、sources_json、origin、base_revision_id?、restored_from_id?、created_at；UNIQUE(topic_id, ordinal)，触发器禁止 UPDATE/DELETE；步骤 12 已实现采纳和回退，用户 review 通过 | 10 |
| suggestions | 步骤 11 已落地 id、topic_id/base_revision_id FK、base_body_md、instruction、body_md、sources_json、materials_json、request_json、provider_snapshot_json（含 context_title）、prompt_version、status/error_code、唯一 request_id、task_id FK、created_at；不充当正式正文 | 11 |
| wiki_decisions | 步骤 12：唯一 request_id、topic_id FK、唯一 suggestion_id? FK、action、revision_id? FK、request_json、created_at；不可变决策记录，事务保证幂等与正文指针一致 | 12 |
| tasks | id、kind、target_id?、status、stage、progress?、input_json、result_json?、error_json?、created_at、updated_at；输入不含密钥 | 5 |
| provider_configs | kind PK(chat/embedding)、base_url、model、options_json、version、updated_at；无明文或密文 key，仅 main 管理 key | 4 |
| search_documents / search_segments | 派生索引版本；原 chunk_id FK、文献/页码、原文偏移与子串、分块版本、预分词文本；不改变按页原文 ID | 8 |
| index_generations / embeddings | generation 保存文献/抽取/分块/配置版本、指纹、实际维度与完成状态；向量以 segment_id FK、generation_id FK 为复合键，little-endian float32，长度=dimension×4 | 8 |
| chunks_fts | FTS5 虚拟表：segment_id UNINDEXED、document_id UNINDEXED、tokens；非权威数据，通过派生块触发器维护，可从当前 chunks 重建 | 8 |

不为简单来源关系额外创建多种 join 表，首版以有类型的 JSON 快照保存；JSON 内 ID 的存在性、归属与状态由服务层在事务内校验。可查询的主要关系仍用外键；以后有复杂查询需求再迁移，不能依赖未校验 JSON 实现权限或证据过滤。

`SourceRef` 固定为：`source_id`（本次内容内引用标识）、`kind`（document/note/message）、`source_object_id`、`source_version`、`excerpt`、`evidence[]`。`EvidenceRef` 包含 `document_id`、`document_title` 快照、`chunk_id`、`physical_page`、`quote`、`extraction_version`。笔记/消息没有原文依据时允许 evidence 为空，但只能标为用户观点或模型推断，不能被呈现为论文证据。材料快照保留被选笔记/消息原文及其引用，避免后续编辑改变旧生成依据。

状态规则：

- 文献抽取：pending → running → ready/partial/failed/unsupported；partial 必须携带警告，未抽出的内容不参与问答。
- 任务：queued → running → succeeded/failed/cancelled/interrupted；启动时将遗留 running 标为 interrupted，用户重试生成新任务；不自动重发可能重复计费的模型调用。
- 消息：streaming → completed/cancelled/failed/interrupted；用户消息直接 completed。取消/失败保留已收到内容与状态，重试新增消息而非伪改历史。
- 建议：draft → accepted/rejected；冲突时仍为 draft，不能写入正式正文。

##### 数据一致性

1. 导入先写临时副本、计算摘要、原子移动到受管路径，再记录文献/任务；失败清理临时文件。启动对账只处理已知临时/孤立导入文件，不扫描删除用户任意路径。重复摘要返回既有文献；已删除文献重新导入可复用其 ID，但旧证据仍按抽取版本显示历史状态。
2. 文献删除采用 tombstone，事务内设置 deleted_at、移除 chunks/embedding/FTS 并停用相关任务；事务提交后删除受管 PDF，失败显示“文件清理待重试”。笔记、消息、修订中的证据快照保留且标为来源失效；这是移除文献，不是擦除所有历史文本。删除确认必须说明这一点。
3. 语义重建索引先生成独立 generation；全部完成后事务切换 active_index_generation，随后清理旧向量。本地关键词重建会明确清除该文献的派生向量。检索限定当前文献、当前抽取版本和匹配的 embedding 配置；配置改变时旧向量不参与新配置检索，重建失败可回退关键词检索。
4. Wiki 保存/采纳/回退用单事务比较 base_revision_id，创建不可变修订并更新当前指针；同一事务校验该修订属于该主题。首次建页创建空正文的第 1 个修订；防止“空基线”歧义。冲突返回 409 与当前版本，前端保留用户草稿。
5. 普通笔记/元数据保存同样检查 version。目录改父级在事务内检查祖先链；首版不提供主题递归删除，避免无必要的数据删除策略扩张。

步骤 8 查询使用规范化向量点积作为余弦相似度，语义候选先按自定义最低相似度过滤（0–1 任意小数，初始 0.50，未经模型校准），再与关键词候选 RRF 合并。关键词命中与达到阈值的语义候选取并集，关键词不受语义阈值约束，不回填弱候选；响应保留每条余弦值、本次阈值与文献最高值供复验，不将其当作相关概率。

#### 4. API 与桌面桥接约定

Python API 前缀 `/v1`，JSON 字段 snake_case。返回普通对象或 `{items: [...]}`；错误统一 `{error: {code, message, retryable, details?}, request_id}`，不泄露路径、key 或上游原始请求头。422 输入错误、404 不存在、409 版本冲突、503 后端/模型未就绪；厂商失败使用可分类错误码，不把所有问题写成“网络错误”。列表首版为本地小库全量列表，不预建复杂分页。

| preload 暴露的业务操作 | main → Python 的对应接口 | 主要输入 → 输出 |
| --- | --- | --- |
| app.getStatus | GET /v1/health | 无 → api_version、ready、schema_version、各连接是否已配置；不返回令牌 |
| documents.importPdf | POST /v1/documents/import | main 原生选文件并读取上传 multipart；renderer 无路径参数 → document、task、deduplicated |
| documents.list/get/update/remove | GET /v1/documents；GET/PATCH/DELETE /v1/documents/{id} | id；PATCH 字段+version；DELETE version → 文献/删除结果 |
| documents.readPdf | GET /v1/documents/{id}/file | id → PDF 字节；main 转为受限字节响应供 PDF.js，不给 renderer 后端地址或任意路径访问 |
| documents.savePosition | PATCH /v1/documents/{id}/position | page → 已保存页码；独立于元数据 version，限制在有效页数内 |
| notes.list/save | GET/POST /v1/notes；PATCH /v1/notes/{id} | 步骤 7：GET 按 document_id；桥接 save 的 version=0 对应 POST（稳定 id、document_id、body_md），已有笔记 PATCH（body_md、version）；sources 由服务端保留，不接受手工伪造 |
| providers.get/save/test | GET /v1/providers；PUT /v1/providers/{kind}；POST /v1/providers/{kind}/test | 配置、测试种类 → 脱敏配置/测试结果；key 由 main 另行保存并注入 |
| tasks.get/cancel/retry | GET /v1/tasks/{id}；POST /v1/tasks/{id}/cancel、/retry | id → task 或新 task_id |
| search.status/index/query/cancel | GET/POST /v1/documents/{id}/index；POST /v1/documents/{id}/search；POST /v1/search/tasks/{id}/cancel | 语义开关与所确认配置版本；main 注入 key；返回任务或原文候选、召回方式与降级原因；tasks.get 可读索引任务，通用抽取 cancel/retry 不处理索引 |
| chat.history/ask | GET/POST /v1/documents/{id}/messages | question、request_id → 历史或 message_id+task_id；上下文由后端受控选择 |
| topics.list/create/update | GET/POST /v1/topics；PATCH /v1/topics/{id} | title、parent_id、version → topic |
| garden.get/save | GET /v1/topics/{id}；POST /v1/topics/{id}/revisions | body_md、base_revision_id → revision、topic；来源由后端保留，不接受手工伪造 |
| suggestions.catalog/preview/generate/list/cancel | GET /v1/materials；POST /v1/topics/{id}/materials/preview；GET/POST /v1/topics/{id}/suggestions；POST /v1/suggestions/{id}/cancel | materials[{kind,id,version,segment_ids}]、instruction、base_revision_id；生成另需 request_id/config_version → 独立草稿及 task_id |
| garden.accept/reject | POST /v1/suggestions/{id}/accept、/reject | request_id、base_revision_id；采纳另含人工确认 body_md；来源只取后端快照 → 当前 view 与原决策 |
| garden.history/restore | GET /v1/topics/{id}/revisions；POST /v1/topics/{id}/revisions/{revision}/restore | request_id、base_revision_id → 当前 view 与新修订决策 |
| workspace.info/catalog/create/save | GET /v1/workspace；GET /v1/exports/catalog；POST /v1/exports；GET /v1/exports/{task_id}/file | note_ids/topic_ids → 导出任务；main 获取含 Markdown/来源清单的 ZIP 并经原生对话框保存，不接受 renderer 任意路径；实际位置由 main 补充 |
| events.subscribe | GET /v1/tasks/{id}/events（SSE） | task_id → 按序事件；main 通过受限 IPC 转发，提供取消订阅函数 |

原生文件选择取消返回 cancelled，不计业务失败。renderer 仅在用户输入 key 时短暂持有表单值，经专用 IPC 提交后清空；保存后不得读回 key。main 密钥密文保存成功后才更新 provider 配置；失败不报成功。Python 内存中的 key 由 main 通过会话鉴权的内部配置操作提供，不入库。没有 key 时仍允许保存配置，状态显示未配置完整。密钥安全能力不可用时拒绝持久化，不能悄悄降级明文。

main 生成会话令牌，经子进程 stdin 传入，Python 绑定端口 0 并以启动消息返回实际端口；stdout 仅用于握手，业务日志走脱敏日志通道。main 健康检查成功后才暴露 ready；renderer 从不获得令牌、端口或通用 HTTP/IPC 方法。校验 IPC 调用来源，只允许应用主窗口；Python 所有业务请求要求令牌。

流式事件信封为 `{task_id, seq, type, payload}`；type 为 progress/text_delta/citations/completed/failed/cancelled。text_delta 含 message_id 与文本；citations 含经过校验的 SourceRef；completed 在数据库提交成功后发送。事件不承诺断线重放，断线时查询任务与已保存消息，不能重新请求模型冒充续传。取消为尽力停止，已经发生的服务商费用不承诺撤销。

提交问答时 request_id 保存于 assistant 消息，并以 (conversation_id, request_id) 非空唯一索引约束；用户消息的 request_id 为空。重复提交返回原 message/task，不重复计费调用；用户明确重试使用新 request_id。任务 target_id 指向该 assistant 消息。单会话只允许一个生成任务，其他请求返回 409。Wiki 生成先保存材料与基础修订的快照，再开始模型任务，完成后写 suggestions 并在任务结果返回 suggestion_id。模型未能产出合法引用时以失败或无依据结果呈现，不能补造引用 ID。

Python 内部最小接口：`ChatProvider.stream(messages, options, cancel)` 产出文本增量与结束信息；`EmbeddingProvider.embed(texts, config)` 返回按输入顺序排列的向量；`Retriever.search(query, document_ids)` 返回带来源候选；`PdfExtractor.extract(file)` 返回按页文本及警告。它们只做相应职责，不互相写数据库；业务服务统一安排事务、任务、模型调用及引用校验。

#### 5. 迁移与依赖锁定

##### 数据迁移

- 迁移按首次落地步骤添加，而非在步骤 3 一次创建全部功能表：工作区/迁移 → provider → 文献/片段/任务 → 笔记 → 检索 → 对话 → 专题/修订 → AI 建议。每个 SQL 文件有递增编号，schema_migrations 保存内容 SHA-256。步骤 8 起以 LF 标准化换行计算新校验和，兼容同一 SQL 精确 LF/CRLF 历史哈希；其他内容变化仍拒绝，不改写旧记录。
- 启动先检查迁移版本和 checksum；数据库版本高于程序支持版本时拒绝打开写模式，提示使用匹配版本。已应用文件 checksum 不一致时停止，不自动修补用户库。
- 升级已有库前使用 SQLite backup API 创建内部迁移备份；不是面向用户的完整备份功能。备份失败不执行升级。
- 每次迁移用显式事务执行，成功后记录版本，再提交；失败回滚且不更新版本。启用外键在事务外执行；迁移后执行 foreign_key_check 与 integrity_check。不要用隐式提交破坏迁移原子性。
- SQLite 单写入队列、短事务、busy_timeout；网络请求和 PDF 抽取不占用写事务。采用 WAL，备份不直接复制运行中的单个 .sqlite3 文件。
- 验证空库初始化、旧版本升级、失败回滚、重复启动无重复应用、较新版本拒绝与引用完整性；在步骤 3 及后续 schema 变化时落实。

##### 工具链与锁文件策略

步骤 0 只读检查；步骤 2 才准备环境和安装依赖。候选工具链为本机已发现的 Node 24.14.0、pnpm 11.25.0、Python 3.12.10、uv 0.11.3；这只是候选组合，不是已通过整套构建的兼容矩阵。

- pnpm：根工作区包含 apps/desktop，根 packageManager 固定已验证 pnpm 版本，Node 版本写入工程版本文件；提交 pnpm-lock.yaml。初次安装生成锁文件，后续复现使用 `pnpm install --frozen-lockfile`。
- Python：services/api 独立项目与 `.venv`，requires-python 为 `>=3.12,<3.13`，`.python-version` 固定实际验证的补丁版本；提交 pyproject.toml 与 uv.lock。后续使用 `uv sync --locked`，不通过自动更新锁文件掩盖漂移。
- Electron/electron-vite/Vite/React/TypeScript 在步骤 2 结合官方 engine、peerDependencies 和生产构建验证后锁定；不能把候选 Node 版本视为全部依赖兼容证据。后续模块按需引入 PDF.js、编辑器、检索等依赖。
- 每次新增依赖同时检查许可、Windows wheel/打包资源、安装脚本与运行需求；测试依赖与发布依赖分组。若需更换技术路线先提出 issue，再由用户决定。
- 步骤 2 在功能编码前验证解释器显式路径、虚拟环境、依赖安装/导入、Node 与构建工具最小运行；本机 uv 缓存权限问题优先用有写权限的项目缓存目录处理并复测，不以管理员权限或切换全局 Python 作为默认解决办法。
- 必须在打包的 Python 中再次确认 SQLite/FTS5 可用，不能拿系统解释器探针替代发布验收。

官方依据（2026-10-22 核查）：[electron-vite 前置要求](https://electron-vite.org/guide/)、[pnpm 锁文件安装](https://pnpm.io/cli/install)、[uv 锁定与同步](https://docs.astral.sh/uv/concepts/projects/sync/)、[SQLite 外键规则](https://www.sqlite.org/foreignkeys.html)。实际安装时再次核查版本和许可证。

#### 6. 待验证事项与交接门槛

| 事项 | 当前结论 | 处理步骤与通过证据 |
| --- | --- | --- |
| 视觉方向 | 用户已选方案三，保留 Storage/Garden/House 名称；步骤 1 设计及步骤 2–8 对应界面已 review，通过范围见各步记录 | 1：统一设计说明与名称修订稿 |
| 工具链 | Python 3.12.10、依赖锁定、开发构建与本机分发已验证；不再沿用设计阶段的未安装状态 | 2：环境检查记录、锁文件及最小构建 |
| 密钥/进程/分发 | 步骤 2、4 已验证启停与本地安全存储；步骤 14 本机安装/故障恢复与 review 通过，干净机器仍未验证 | 2、4、14：安全保存与恢复、子进程启停、本机安装与待补独立环境 |
| 真实模型与预算 | 用户已确认 DeepSeek 聊天接入及智谱 embedding-3 检索 review；预算、普遍语义质量未作保证 | 4：用户安全配置与短文本连接测试，分别验证 chat/embedding |
| PDF 与跨语言检索 | 步骤 5、8 固定夹具与用户样例通过；代表性长文与逐题质量统计待后续集成验收 | 5、8：合法样例清单、摘要、证据页码与 PLAN 的 12 问记录 |
| 修订与来源 | 步骤 9–11 已实现并通过 review；步骤 12 的引用修订、并发冲突、回退与重启测试已通过，并于 2026-10-24 通过用户 review | 9–12：真实引用流转、删除失效、冲突/回退测试 |
| 干净 Windows | 2026-10-25 用户选择暂时无独立环境，先交付本机验证版 | 本机受限 PATH / 安装检查与干净 Windows 分开记录，不宣称完整发布验收通过 |

步骤 0 的设计交付与设计分支合并已完成；当前进度以 PLAN 为准。后续仍按功能分支逐步实现、等待用户 review，不自动进入下一步或合并。

步骤 9 已通过用户 review（2026-10-24），后续合并 main（82cb6c1 / PR #9）：证据预览确认后发送，外部 SSE 增量持久化、本地每 500ms 轮询，历史不自动进入下一轮提示。引用按本轮 S 编号校验并支持物理页跳转；转笔记保留原始引用且不覆盖草稿。边界、状态与真实服务验收见[步骤 9 记录](v0.1.0.md#step-09)。

步骤 10 在 feature/garden-editor 已通过用户 review（2026-10-24），已提交 9b42842，随 PR #10 合并 main（fa97a09）：专题目录与人工正文修订已落地，保存正文比较 base_revision_id；改名/移动比较 topic.version，父级链检查防环。初始空白修订为 1，历史只读。详情见[步骤 10 记录](v0.1.0.md#step-10)。

步骤 11 按用户明确授权沿用 feature/garden-editor（Step 10 提交 9b42842），不新建分支。材料目录/预览、配置版本绑定发送、任务生成与来源快照已实现，2026-10-24 用户 review 通过；提交 d05ceba，随 PR #10 合并 main（fa97a09）。材料对象版本、范围限制和状态规则见[步骤 11 记录](v0.1.0.md#step-11)。步骤 11 本身不修改正式正文；步骤 12 的显式确认接口另行负责创建新修订。


步骤 12、13 按用户明确授权在 feature/wiki-review-export 合并交付，起点 main fa97a09，2026-10-24 用户 review 通过；已提交 5bd8533，随 PR #11 合并 main（3fb4860）；步骤 14 在 feature/mvp-release-validation 执行。schema 8→9 只新增 009_wiki_decisions.sql，不修改已应用迁移。POST /v1/suggestions/{id}/accept、/reject 和 /v1/topics/{id}/revisions/{revision}/restore 为本地确认操作，不调用模型。采纳要求已完成、尚未处理、同一正文基线、材料仍有效，以及合法本轮引用；拒绝不改正文；回退复制目标历史正文及原始来源 JSON，新建修订。每个操作绑定 UUID request_id，重试返回原决策和当前正文，不重复修改指针。动态来源可用性不写回不可变快照。详见[步骤 12 记录](v0.1.0.md#step-12)。

House 数据位置由 main 从当前实际工作区路径提供；renderer 不传任意路径。GET /v1/exports/catalog 返回可导出的已保存内容，POST /v1/exports 按选择的 IDs 在同一数据库锁内创建快照，返回成功 export task；GET /v1/exports/{task_id}/file 返回受限 ZIP 字节，main 通过系统保存对话框写入，临时文件加 rename 避免部分写入损坏已有目标。取消、写入失败和受保护路径不会报告成功。内容格式 yorw-content-export-v1，文件名使用 UUID，正文与来源清单分开；不含完整备份/恢复/目录迁移。详见[步骤 13 记录](v0.1.0.md#step-13)。


步骤 14 于 2026-10-25 通过用户 review（本机范围），feature/mvp-release-validation 提交 efa63da 随 PR #12 合并 main（6937846），2026-10-25 发布 v0.1.0 预发布版本。沿用已锁定依赖；当前实际前端使用 React/TypeScript、CSS 和现有模块状态对象，规划中的 Tailwind/shadcn、TanStack Query/Zustand 尚未引入，README 按当前依赖修正，不视为技术路线更换。新增隔离连续流程与服务退出/重启烟测、受限 PATH 验证脚本及自编写样例生成器；smoke 模式的 Electron profile 也隔离到报告目录，普通启动路径不变。HTTP 关闭等待增加 2 秒边界，防止停止读取 PDF 的客户端无限阻塞服务退出，Electron 继续保留 3 秒回收兜底；不改变 SQLite 事务或模型数据协议。安装包保留资源版本编辑、关闭代码签名，携带使用文档；未做自动更新；发布状态及线上制品与本机包的差异见 [v0.1.0 发布说明](../releases/v0.1.0.md)。干净 Windows 与真实论文逐题质量评估仍未验证。详情见[步骤 14](v0.1.0.md#step-14)。

---

<a id="ui-design"></a>

## 原记录：`docs/design/step-01/design_ui.md`

原文件 SHA256：`333ed4767e4aefbe053ca04f477746612183f9a2813a44c570445e6f62571cad`。

### 步骤 1：Yorw 界面设计方案

2026-10-23 · 步骤 1 设计 review 通过；本次按用户要求将方案记录与视觉规范合并为本文。应用尚未实现，设计分支尚未合并。

#### 已选方案与阅读入口

采用方案三：**顶部横向导航、蓝色主题、PDF 阅读优先**。最终视觉目标为 [selected-v2.png](../design/reference.png)，在 `option-3.png`（历史备选图，见 Git `2c31cae:docs/design/step-01/option-3.png`） 基础上保留布局与配色，修正正式导航名称并补充示例论文标识。本文是步骤 1 的统一设计说明，包含选择依据和后续实现约定。

依据：[开发计划](design.md#mvp-plan)、[工程基线](design.md#engineering-baseline)。检查证据见[步骤 1 验收记录](v0.1.0.md#step-01)。

#### 产品名称与文化

全局入口及对应页面名称固定为 **Storage / Garden / House**，大小写不变，不以“文献 / 专题 / 设置”替换，不在导航中增加通用中文前缀。这是用户明确确认的产品文化要求，后续 Agent 必须遵循。

Storage 承载研究材料、阅读、笔记与有证据的讨论；Garden 承载专题 Wiki 的生成、编辑与持续修订；House 承载个人工作区配置，首版只做模型连接、数据位置和导出，个人资料与研究主题后置。可在帮助、空状态和首次引导中解释功能，不改入口名称。按钮等其他操作文案继续使用清楚的中文。

#### 布局与样式基线

| 项目 | 实现约定 |
| --- | --- |
| 导航 | 顶部横向导航，品牌位于左侧；Storage、Garden、House 位于中部；当前项用蓝色文字与下划线同时表达，无全局左导航栏。 |
| 阅读工作区 | 顶部导航下方一行文献工具栏，包含返回文献库、标题、页码、缩放及侧栏控制；下方 PDF 主区域和右侧辅助面板。 |
| 面板 | 1440px 参考宽度下右侧约 400px，可调至 320–480px，且至少给正文保留 640px；空间不足时收起辅助面板，用户主动打开则覆盖右侧，不挤压正文。 |
| 阅读优先 | 列表进入文献后收起；讨论/笔记共用一个侧栏，通过标签切换；支持关闭，关闭后工具栏提供重新打开入口。 |
| 主色 | 强调色 #3158C9，hover #2747A6；浅蓝选中底 #EAF0FF。用于主操作、选中项、证据竖线和链接，不铺满大面积背景。 |
| 表面与文字 | 背景 #F4F6F9、内容 #FFFFFF；正文 #1E293B、次要文字 #526174、分隔线 #DCE2EA。 |
| 字体 | UI 使用 Segoe UI、Microsoft YaHei、sans-serif 系统栈；正文 15px/1.6，辅助说明 13px/1.5，导航 16px；PDF 保持原文件字体。 |
| 间距与控件 | 4px 基础间距，主要间距 8/12/16/24px；工具栏与面板内边距 16px，主要按钮高度 36px，小控件圆角 4px，输入框 8px。 |
| 状态色 | 错误 #B42318、成功 #237A45、警告 #8A5700；均搭配文字或图标，不能仅靠颜色识别。 |
| 交互反馈 | 键盘焦点采用清晰的 2px 蓝色轮廓；选中项有下划线/文字反馈。拖动分隔线提供可见手柄和可访问名称。 |

以上是实现目标值，不声称图像逐像素匹配或已做对比度/无障碍实测。保留方案三的信息层级与空间关系，不把示例论文文字当作真实模型答案，也不把栅格稿的字体瑕疵复制进代码。

#### 状态与其他页面的延续

- 缺模型配置时解释限制并提供“前往 House”；不影响已有文献阅读与编辑。
- Storage 空状态提供“导入 PDF”；Garden 空状态提供“创建专题”；House 按聊天模型、embedding、数据与导出分组。所有空状态仍使用正式页面名称。
- Garden 沿用顶部导航与蓝色系统，主题树是页面内部目录，不是新的全局导航；正文优先，AI 建议按需展开并先预览后确认。
- House 沿用相同字体、控件、分隔线与状态反馈。Garden/House 尚未绘制独立页面稿，具体页面在各自步骤交付 review。
- 示例高亮仅表达引用关系，首版只承诺页码跳转与证据片段，不据图片增加精确坐标标注功能。

#### 状态呈现与操作约定

| 场景 | 呈现与可用操作 |
| --- | --- |
| 正在加载 PDF | 阅读区域显示“正在加载文献”；失败后显示原因、重试和返回入口，不用空白页表示失败。 |
| 等待 / 生成回答 | 输入提交后展示当前任务状态与停止按钮；生成期间阻止重复提交，同一位置显示已收到的文字。 |
| 回答被停止 / 失败 | 标记“已停止”或“生成失败”，保留已有文字及用户问题；允许重新提问，不显示完成标记。 |
| 无可用证据 | 明确显示“未找到足够的文献证据”，不给出虚假的页码或来源；允许用户调整问题。 |
| 笔记保存中 / 失败 | 保存中显示进度文字；失败保留编辑内容并提供重试，成功后才标记“已保存”。 |
| 引用来源已失效 | 保留证据快照，标明原文不可用；禁用跳转并解释原因，不伪装成仍可定位。 |

以上状态使用统一的小型图标、文字与语义色；状态信息贴近对应内容，避免只用短暂提示承载错误原因。具体错误文案以真实失败原因和工程接口为准。

侧栏关闭和讨论/笔记标签切换不丢弃输入草稿。窄窗口覆盖面板通过显式按钮打开，关闭按钮及 Escape 可关闭；关闭后焦点返回打开入口。覆盖期间限制焦点在面板内，宽窗口并排模式不限制焦点。拖动分隔线同时提供键盘调整能力，保持 320–480px 的宽度边界；空间不足时切换覆盖模式。引用跳转后保留当前问答，便于对照原文。

实现时分别核查 1440×1024 参考窗口和 1024×768 窄窗口，验证导航不重叠、PDF 可滚动、输入与关闭入口可达；这两组尺寸是验收场景，并非已验证的运行结果。

#### 候选方案与选择记录

三张正式候选均为同一流程：阅读示例 PDF → 围绕当前文献提问 → 查看页码与证据 → 保存为笔记。编号按本轮三张有效结果在聊天中的实际展示顺序；早期出现额外导航和错误讨论布局的草图已弃用，不计入候选。一次顶部导航方案生成因网络错误失败，已重新生成。

| 编号 | 图片 | 布局与候选视觉约定 |
| --- | --- | --- |
| 1 | `option-1.png`（历史备选图，见 Git `2c31cae:docs/design/step-01/option-1.png`） | 暖纸阅读：暖白底、深绿强调色；浅色左侧窄导航，顶部品牌栏，右侧讨论面板。候选背景 #F6F4EF、强调色 #28574B、小圆角 6px。 |
| 2 | `option-2.png`（历史备选图，见 Git `2c31cae:docs/design/step-01/option-2.png`） | 专注阅读：深灰左侧窄导航、浅灰阅读底、白色 PDF；右侧讨论采用页边记录层级。候选导航 #252A30、阅读底 #ECEFF1、强调色 #2B656A、圆角 8px。 |
| 3 | `option-3.png`（历史备选图，见 Git `2c31cae:docs/design/step-01/option-3.png`） | 冷静工作台：顶部横向导航，不占左侧栏；紧凑文献工具条，右侧证据采用蓝色竖线。候选背景 #F4F6F9、强调色 #3158C9、圆角 4px。 |

以上尺寸/色值是设计意图，未从栅格图逐像素取样，不宣称图片精确遵循数值。目标画布为 1440×1024，实际生成图片尺寸以文件为准。现以方案三修订稿及本文规范作为依据，不混合三个方案。

#### 视觉核查与实现边界

三套候选围绕同一阅读与问答流程比较，最终修订图已核查 Storage、Garden、House 正式名称、顶部导航、PDF 主区域、讨论/笔记标签、当前论文范围、页码证据、保存为笔记及输入区。原候选图中的中文导航只属于设计历史，不作为实现依据。

讨论仅针对当前论文；回答附页码与原始片段，保存为笔记保留来源关系。图片中的论文、问答和表格均为虚构示例，不是科研结论或模型实测；后续演示继续保留示例标识。

当前图片只展示正常阅读/问答状态，其他状态由本文约定，尚未逐一绘制。图片不证明应用可运行、PDF 解析正确、键盘或屏幕阅读器可用、对比度达标。以上检查在对应功能实现后完成。

用户已确认本步设计，文档整理不改变已确认范围。本次不安装依赖、不创建应用骨架、不提交或合并分支、不进入步骤 2；后续按 PLAN 的分支与逐步 review 流程推进。

---

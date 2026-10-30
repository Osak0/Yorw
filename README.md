# 知栖 Yorw

**Your own research workplace.** Windows 本地优先的科研阅读与知识工作区，将文献、带来源问答、笔记和专题 Wiki 连接起来。

- **Storage**：批量导入 PDF、DOCX、DOC、Markdown 和 TXT，以目录和搜索管理文献；阅读、检索、问答与笔记可在侧栏或独立标签中使用，资料页管理 AI 整理与阅读历史，元数据页统一维护标签、总结及关系。
- **Garden**：组织专题与关联文献，编辑 Wiki；AI 默认根据当前专题及子专题材料生成可编辑草稿，由用户追加或替换并保留修订。
- **House**：配置聊天与检索服务、语义检索偏好，查看数据位置并导出已保存内容。

## 当前状态

**阶段一、阶段二均已 review 通过并合并到 main（PR #19 / 639509b / schema 20）。** 应用版本仍为 0.2.0，不代表新的公开发布。v0.3.0 继续进行[文献管理与工作区体验改进](PLAN_v0_3_0.md)，当前完成整改阶段三及生成记录/统一元数据修订（分支 schema 22），已由用户 review 通过；Garden 专题导航与标签页改造已实现并通过本地回归，等待 review。状态见 [PLAN](PLAN.md)，已完成能力与验证边界见[阶段二记录](docs/history/v0.3.0-phase2.md)。

PDF、DOCX、Markdown、TXT 基础处理无需外装解析组件；旧 DOC、OCR 和 Word 版式转换的可选配置见[使用指南](docs/user-guide.md#house内置能力与可选解析组件)。自动整理需用户授权和聊天模型，不阻塞阅读；元数据辅助检索默认关闭，仍返回原文依据。真实模型质量和独立干净 Windows 验收后置。内容导出不是完整备份。

## 10分钟极速复现指南

目标是在环境准备好后，约十分钟完成“启动 → 导入 → 阅读与笔记 → 专题 → 保存重启”的最小流程。有可用模型服务时可继续体验问答和 AI 草稿。首次安装工具、下载 Electron/Python 和依赖、网络等待及完整打包不计入十分钟；本项目没有在全新机器上测得固定十分钟的完成时长。

### 一次性环境配置

使用 Windows x64 和 PowerShell，先安装 Git 和下列工具，安装后重新打开终端。源码开发不需要本地 GPU、Docker、外部数据库或独立向量数据库。

| 工具 | 项目要求 | 配置依据 |
| --- | --- | --- |
| Git | 可执行 clone 和 checkout 的版本 | 用于取得源码和确认提交。 |
| Node.js | 24.x，优先 24.14.0 | [`.node-version`](.node-version)；从 [Node.js 官方下载入口](https://nodejs.org/en/download)选择对应 Windows x64 版本。 |
| pnpm | 11.25.0 | 根 `packageManager`；Node 安装后执行 `npm install --global pnpm@11.25.0`，参见 [pnpm 安装说明](https://pnpm.io/installation)。 |
| uv | 可执行下文 install 和 locked sync 的版本 | Windows 可执行 `winget install --id=astral-sh.uv -e`，参见 [uv 安装说明](https://docs.astral.sh/uv/getting-started/installation/)。当前仓库未锁定 uv 自身版本，复现时记录 `uv --version`。 |
| Python | 3.12，优先 3.12.10 | [`services/api/.python-version`](services/api/.python-version)；可由 `uv python install 3.12.10` 安装。 |
| 模型服务 | 可选，自备可用配置与密钥 | 聊天兼容 Chat Completions，检索兼容 embeddings；在 House 设置。 |

首次下载需要访问源码仓库、npm、Python 包与运行时分发站点。若 `pnpm` 被本机 PowerShell 脚本执行策略拦截，可使用 `pnpm.cmd`；不需要修改系统全局执行策略。

### 获取源码并启动

下面固定到已合并、review 通过的阶段二提交，包含多格式基础阅读与可选 AI 文献整理。已有本地开发仓库可跳过 clone/checkout，先核对分支和工作区。不要在有未提交修改时直接切换版本。

```powershell
git clone https://github.com/Osak0/Yorw.git
Set-Location Yorw
git checkout 639509bc61e53051889352c8a1c3745aeaad70c1
git rev-parse HEAD
node --version
pnpm --version
uv --version

$env:UV_CACHE_DIR = "$PWD/.cache/uv"
uv python install 3.12.10
pnpm install --frozen-lockfile
uv sync --project services/api --locked

# 生成可公开复用的自编写样例，不需要下载真实论文。
# 输出目录必须不存在；重复操作时换一个目录名。
services/api/.venv/Scripts/python.exe scripts/make-mvp-fixtures.py .cache/quickstart-fixtures
pnpm dev
```

预期出现知栖窗口，顶部可切换 Storage / Garden / House，本地服务进入已连接状态。`pnpm dev` 会启动 Electron 及其管理的 Python 后端，无需另开 `uvicorn`。开发数据使用独立的 `Yorw-development` profile；启动不会自动载入正式安装版资料。

### 导入原文并保存笔记

在 Storage 点击“导入文献”，选择 `.cache/quickstart-fixtures/fixture.pdf`。打开后应有两页原文，第一页文字是 `Yorw fixed English fixture evidence.`。在笔记中写入“这是复现笔记”，保存后切换标签再打开，确认内容仍在。样例目录还包含四份文字 PDF 和三个负例文件，负例不要求文字抽取成功。

### 体验检索问答和专题草稿

不配置服务时，可在 House 关闭语义检索，返回 Storage 搜索 `English fixture evidence`，检查摘录和第一页跳转；也可直接在 Garden 创建专题并手工编辑、保存正文。

如需 AI 流程，先在 House 分别填写聊天与检索服务的 API Base URL、模型名和 API Key，保存后点击“测试已保存配置”。Base URL 使用服务商提供的 API 基地址，不包含 `/chat/completions` 或 `/embeddings`，程序会追加端点；外部服务使用 HTTPS，本地服务可用 HTTP loopback。配置示例字段说明见[环境模板](.env.example)，不把密钥写入仓库。

回到当前文献，提问“请说明本页提供的英文证据，并引用来源”；检查回答的来源是否能回到原文。创建 Garden 专题，在“关联材料”中关联该文献，再进入“AI 优化”，保留默认“当前专题及子专题”，输入“根据已关联原文整理一段简短说明，区分原文与个人理解并保留来源”。生成后核查、编辑并追加到正文。没有关联材料时，提示范围为空是预期行为。

本地未配置模型也能完成基础流程；仅有聊天配置并关闭语义检索时可尝试基于文字匹配的问答和草稿。真实服务输出会变化，不要求与夹具截图逐字一致。

### 验证持久化并导出

保存笔记和专题正文，正常退出，再执行 `pnpm dev`。确认文献、已保存笔记、专题正文和工作标签可继续使用。在 House 选择笔记或 Wiki，创建快照并保存 ZIP，检查 Markdown 和来源清单。此 ZIP 不含完整 PDF 工作区，不用于验证完整备份恢复。

### 依赖清单与环境变量模板

下表列出直接依赖；传递依赖、完整版本和校验信息以 [`pnpm-lock.yaml`](pnpm-lock.yaml) 与 [`uv.lock`](services/api/uv.lock) 为准。不要逐项安装表中的包，也不要在复现时更新锁文件。

| 分组 | 直接依赖 |
| --- | --- |
| 前端运行 | react 19.3.1、react-dom 19.3.1。 |
| 桌面及构建 | electron 45.0.0、electron-vite 6.0.0、electron-builder 26.15.3、vite 8.3.5、typescript 7.0.2。 |
| 阅读及编辑 | pdfjs-dist 6.4.299、codemirror 6.0.2、@codemirror/lang-markdown 6.5.2、@codemirror/state 6.7.6、@codemirror/view 6.43.15、react-markdown 10.1.0、remark-gfm 4.0.1。 |
| 类型及桌面测试 | @types/node 24.10.1、@types/react 19.3.0、@types/react-dom 19.3.0、vitest 5.0.5。 |
| 后端运行 | fastapi、pydantic、uvicorn、numpy、pypdf、python-multipart；声明见 [`pyproject.toml`](services/api/pyproject.toml)，精确解析版本见 uv.lock。SQLite 使用 Python 标准库，要求支持 FTS5。 |
| 后端开发及打包 | pytest、pyinstaller，由同一 uv.lock 解析。 |

环境示例见 [`.env.example`](.env.example)。**应用当前不自动加载 `.env`**；开发时在 PowerShell 显式执行 `$env:UV_CACHE_DIR = "$PWD/.cache/uv"`。模型地址、型号和密钥只在 House 填写。工作区路径、私有端口和会话令牌由主进程管理，不需要也不提供 `.env` 覆盖。

### 常见启动问题

| 现象 | 处理方式 |
| --- | --- |
| 找不到 node、pnpm 或 uv | 完成一次性安装并重开终端，用上文版本命令确认 PATH。 |
| 下载依赖失败 | 检查网络后按原锁文件重试，保留完整报错；不通过升级依赖解决下载失败。 |
| 生成样例提示目录存在 | 换一个新的 `.cache/` 子目录，不覆盖此前样例。 |
| 本地服务未连接 | 确认在仓库根目录完成 locked sync，且生成了 `services/api/.venv/Scripts/python.exe`；记录界面错误码。 |
| 资料范围为空 | 在 Garden 关联文献，或显式改用全工作区，不将空范围视为模型故障。 |
| 模型鉴权或端点错误 | 检查 House 基地址、模型和密钥，先通过连接测试；不要把密钥写入反馈。 |

完整类型检查、测试、冻结后端及打包命令统一见[开发指南](docs/development.md)。十分钟体验不等于整套回归通过，也不等于独立干净 Windows 验收。

## 开发协作中的核心提示词

以下是已读取历史聊天中可核对的**用户原话节选**，完整记录导出后，将补充逐轮提示、生成结果、修正和验收。

**先拆阶段再实现**，来源为历史聊天“规划并实现mvp版本”的初始需求：

> 请你在制定计划时，将整体开发过程细分为多个步骤，每个步骤只针对实现特定的功能或者页面模块，每次实现后需要等待我review，决定是否进入下一个开发阶段；

**保留产品结构并优化交互**，来源为“开发 Yorw v0.2.0”中制定界面改进计划的需求：

> 当前 wiki 的模式为层次化目录，后续我们会新增思维导图，卡片盒法等知识构建形式，当前我们着重优化层次化目录版本

**明确当前操作边界**，来源为同一聊天中添加实施计划的需求：

> 将该套餐（计划）整理到Yorw文件夹中，文件名称为PLAN_v0_2_1.md，为其他Agent执行提供计划参考；请你只添加该文档，不要实际执行该计划

历史聊天定位：[规划并实现mvp版本](thread://01a16195-e33c-70a3-a0dc-bc9fa55186ac?hostId=local)、[开发 Yorw v0.2.0](thread://01a17301-8264-71a2-acef-addfe365cbca?hostId=local)。这些链接供作者在 Codex 内定位，外部评审需要后续提供可读取的脱敏导出件。架构、运行时 Prompt、审核机制和证据缺口见[技术文档](docs/technical-report.md)。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [PLAN](PLAN.md) | 当前集成状态、下一步和后置范围。 |
| [v0.3.0 计划](PLAN_v0_3_0.md) | 已确认范围、14个实施步骤、阶段 review 与验收。 |
| [v0.3.0 阶段二记录](docs/history/v0.3.0-phase2.md) | 自动整理、元数据检索、固定评估与验证证据。 |
| [v0.3.0 阶段一记录](docs/history/v0.3.0-phase1.md) | 阶段一提交、关键整改、review 结论与验证证据索引。 |
| [产品约定](docs/product.md) | 三个空间、体验原则与视觉。 |
| [架构](docs/architecture.md) | 现役模块、数据、来源和 AI 工作流。 |
| [开发指南](docs/development.md) | 环境、回归、打包与复现。 |
| [使用指南](docs/user-guide.md) | 使用方法、异常处理及能力边界。 |
| [作品介绍源稿](docs/project-introduction.md) / [Word 版](docs/作品介绍.docx) | v0.2.0 作品材料底稿：项目、AI 测试、图片与原创声明；不作为 v0.3.0 现役说明。 |
| [技术文档源稿](docs/technical-report.md) / [Word 版](docs/技术文档.docx) | v0.2.0 技术材料底稿：意图控制、Prompt、架构与可复现性；后续按真实对话导出更新。 |
| [v0.2.0](docs/releases/v0.2.0.md) / [v0.1.0](docs/releases/v0.1.0.md) | 版本变化和发布状态。 |
| [设计历史](docs/history/design.md) / [v0.1.0 开发记录](docs/history/v0.1.0.md) | 原始设计与 MVP 实施证据。 |
| [v0.2.0 AI 改进](docs/history/v0.2.0.md) / [工作区改进](docs/history/v0.2.0-workspace.md) | AI 流程和原 v0.2.1 计划、A/B/C 实施记录。 |
| [v0.2.0 发布准备](docs/history/v0.2.0-release-preparation.md) | v0.2.0 历史候选制品、发布准备与验收证据。 |

后续 Agent 从 [AGENTS](AGENTS.md) 进入。历史是发生时的证据，无需全部作为当前开发指令加载。自动化测试、必要夹具和复现工具继续维护；测试 PDF、数据库、报告和制品在忽略目录中按需生成。

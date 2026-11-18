# 知栖 Yorw

**Your own research workplace.** Windows 本地优先的科研阅读与知识工作区，将文献原件、带来源问答、阅读笔记与层级专题 Wiki 连接在同一可核查的工作流中。

- **Storage（积累材料）**：批量导入 PDF、DOCX、DOC、Markdown 和 TXT，通过类文件系统的逻辑目录与搜索管理文献；阅读、混合检索、带 `[S]` 引用问答与阅读笔记可在阅读器侧栏或独立工作标签中无缝切换；支持正式元数据维护与 AI 辅助文献整理（按栏或全部原子采纳）。
- **Garden（培育知识）**：以层级树和路径双视图组织研究专题；专题概览统一管理多份自有笔记、共享阅读笔记、关联材料与显式祖先笔记范围；研究助理支持指定工作区或专题范围、文件夹式会话分区、可纠正/可遗忘的研究记忆，以及回复内可点击资料导航卡片；所有新建专题、笔记写入与关联修改均先生成结构化方案预览，支持勾选部分采纳、前置依赖联动、版本冲突拦截与受保护撤回。
- **House（安放工作区）**：配置聊天模型、Embedding 检索服务、研究助理多模型 Profile（支持聊天连通性与三轮工具闭环检测）及可选外部解析组件，经系统安全存储保护 API 密钥，查看本地数据目录并导出已保存内容与来源清单快照。

## 当前状态

**v0.4.0 功能开发已完成，正在准备本地发布**；应用与后端包版本均为 **0.4.0**，SQLite schema **31**（共 001–031 顺序只追加迁移，细粒度 Git 演进记录见仓库提交历史，AI 协同开发原始对话与提取稿位于提交材料外层 `ai-cowork-history/`）。当前分支、验证基线（后端 `pytest` **439 passed**、桌面 `Vitest` **106 passed**）与发布步骤统一见 [PLAN](PLAN.md)，本版更新说明见 [v0.4.0 发布说明](docs/releases/v0.4.0.md)。2026-11-18 核验 GitHub 尚无远端 v0.4.0 Release。

PDF、DOCX、Markdown、TXT 基础导入与阅读全部内置，无需外装任何第三方解析器；旧 DOC 转换、Docling 增强解析与 OCR 为用户主动配置的可选能力，详见 [使用指南](docs/user-guide.md#house内置能力与可选解析组件)。未配置云端模型密钥时，导入、原件阅读、笔记、专题编辑与本地文字检索均可离线正常使用。

---

## 复现性声明与双轨复现说明

为便于评委与开发者全面核验本项目的真实开发过程与工程质量，本文档同时提供两条边界清晰的复现路径：

1. **轨道一（核心评审复现）：[10分钟极速复现指南（从零空目录构建 MVP 应用）](#10分钟极速复现指南从零构建-mvp-应用)**
   这里的“复现”**不是**安装现成安装包后点按试用功能，也**不是**克隆本仓库既有业务源码，而是指：**在全新空目录中，仅依据下文提供的环境配置说明、依赖清单、环境变量模板与结构化核心提示词，驱动具备目录读写与终端执行能力的 AI 编程助手（如 Codex、Claude Code、Cursor 等），从 0 生成、运行并验收具备核心闭环的 Yorw MVP 版本应用**。
2. **轨道二（成品工程核验）：[成品仓库（v0.4.0）源码锁定复跑指南](#成品仓库v040源码锁定复跑指南)**
   基于本仓库锁文件（`pnpm-lock.yaml` 与 `services/api/uv.lock`）与确定性合成夹具，一键复跑历经 `v0.1.0 → v0.4.0` 完整演进的现役桌面应用与自动化回归测试。

### 确定性与边界声明

- **验收判据（契约等价而非逐字雷同）**：大语言模型在不同时间或不同编程助手下生成的源码文件不可能逐字符一致。空目录重建 MVP 的成功判据是**四层安全进程拓扑、SQLite 权威持久化、PDF 原件阅读与物理页抽取、带页码依据问答及乐观锁版本采纳契约全部通过实测与反例验证**，而非代码文本相似度。
- **10 分钟预算边界**：10 分钟是指完成一次性基础运行时（Node.js、pnpm、Python、uv）安装后，在空目录执行首轮 AI 生成、依赖同步、自动化测试与桌面最小闭环核验的目标操作预算；首次工具链下载、网络波动排障以及 v0.4.0 后续迭代的复杂特性（研究记忆、多格式外部解析器、NSIS 安装包构建等）不计入该 10 分钟 MVP 范围。
- **数据流向与模型随机性**：本地基础阅读、笔记和关键词检索不发起任何外部请求；启用聊天、Embedding 语义检索或自动整理后，所选文本片段会发送至用户在 `House` 配置的模型服务。由于远端商业模型可能迭代且未对全部接口强制固定随机种子，自然语言文本不承诺逐字一致，工程协议与状态机行为则通过确定性本地夹具精确复现。

---

## 环境配置说明、依赖清单与环境变量模板

无论是“空目录 10 分钟重建 MVP”还是“成品 v0.4.0 源码复跑”，均复用同一套轻量 Windows 本地工具链，**无需本地 GPU、无需 Docker、无需外部独立数据库或外部向量数据库**。

### 1. 环境配置说明

使用 **Windows 10/11 x64** 与 **PowerShell**，预先安装下表工具并重新打开终端使 `PATH` 生效：

| 工具 / 服务 | 版本要求与参考基线 | 安装方式与配置依据 |
| --- | --- | --- |
| **Git** | 任意支持 `init` / `clone` / `checkout` 版本 | 用于初始化空目录仓库或检出源码并记录复现指纹。 |
| **Node.js** | `24.x`（推荐 `24.14.0`） | 对齐仓库 [`.node-version`](.node-version)；从 [Node.js 官方下载页](https://nodejs.org/en/download) 安装 Windows x64 版本。 |
| **pnpm** | `11.25.0` | 对齐根 `packageManager`；安装 Node 后执行 `npm install --global pnpm@11.25.0`（若本机 PowerShell 脚本执行策略拦截 `pnpm.ps1`，直接调用 `pnpm.cmd`，无需修改系统全局执行策略）。 |
| **uv** | 支持 Python 安装与锁同步版本（参考 `0.11.3`） | Windows 执行 `winget install --id=astral-sh.uv -e`，参见 [uv 官方安装文档](https://docs.astral.sh/uv/getting-started/installation/)；复现时记录 `uv --version`。 |
| **Python** | `3.12.x`（推荐 `3.12.10`，需内置 SQLite FTS5） | 对齐 [`services/api/.python-version`](services/api/.python-version)；可直接由 `uv python install 3.12.10` 自动安装管理。 |
| **AI 编程助手** | 仅空目录重建 MVP 时需要 | 如 Codex CLI、Claude Code、Cursor 等，需具备工作区文件读写与本地终端命令执行权限。 |
| **兼容模型 API** | 可选（自备兼容 OpenAI 协议端点与密钥） | 聊天兼容 `/chat/completions`，语义检索兼容 `/embeddings`；在应用 `House` 页面配置。无密钥时可用内置确定性本地夹具验证全部工程闭环。 |

### 2. 依赖清单（MVP 核心集与 v0.4.0 完整集对照）

下表给出经本机实测兼容的精确直接依赖清单。**空目录重建 MVP 时**，AI 编程助手应据此生成新项目自己的 `package.json`、`pyproject.toml` 并现场生成匹配的锁文件（切勿直接复制成品仓库锁文件到不同依赖声明的新项目中）；**成品源码复跑时**，直接以仓库锁文件 [`pnpm-lock.yaml`](pnpm-lock.yaml) 与 [`services/api/uv.lock`](services/api/uv.lock) 锁定安装。

| 分组 | 10 分钟 MVP 极速复现必需核心依赖 | v0.4.0 完整版新增扩展依赖 |
| --- | --- | --- |
| **前端与桌面宿主** | `react 19.3.1`、`react-dom 19.3.1`、`electron 45.0.0`、`electron-vite 6.0.0`、`vite 8.3.5`、`typescript 7.0.2` | `electron-builder 26.15.3`（Windows NSIS 安装器打包） |
| **原文阅读与富编辑** | `pdfjs-dist 6.4.299`（PDF 原件物理页渲染） | `codemirror 6.0.2`、`@codemirror/lang-markdown 6.5.2`、`@codemirror/state 6.7.6`、`@codemirror/view 6.43.15`、`react-markdown 10.1.0`、`remark-gfm 4.0.1` |
| **前端类型与测试** | `@types/node 24.10.1`、`@types/react 19.3.0`、`@types/react-dom 19.3.0`、`vitest 5.0.5` | 同左（随模块增长扩充组件与工作区标签测试） |
| **Python 后端服务** | `fastapi 0.159.1`、`pydantic 2.14.1`、`uvicorn 0.54.0`、`pypdf 6.21.2`、`python-multipart 0.0.32`、Python 标准库 `sqlite3`（含 FTS5） | `numpy 2.5.4`（本地小库向量精确余弦检索与缓存） |
| **后端测试与冻结** | `pytest 9.1.1` | `pyinstaller 6.22.3`（独立冻结后端 `yorw-api.exe`） |

### 3. 环境变量模板（`.env.example`）

项目根目录环境变量模板内容如下（与仓库 [`.env.example`](.env.example) 完全一致）：

```dotenv
# Yorw 开发环境填写示例，不会被应用自动加载。
# 在仓库根目录的 PowerShell 中执行：
# $env:UV_CACHE_DIR = "$PWD/.cache/uv"
UV_CACHE_DIR=.cache/uv

# 模型配置请在应用 House 中填写，不在此文件保存密钥。
# 聊天服务：API Base URL / 模型名 / API Key
# 检索服务：API Base URL / 模型名 / API Key
# Base URL 不含 /chat/completions 或 /embeddings，程序会追加端点。
# 外部服务使用 HTTPS；本地服务可使用 HTTP loopback。
# 示例字段均需替换为自己服务商提供的真实值，不提供通用模型名。

# 不设置 Electron userData、后端端口或会话令牌。
# 这些参数由应用启动流程管理，不提供 .env 覆盖入口。

# 最小开发环境无须配置其他环境变量。
# 可选：仅在主动使用 Docling 的 OCR/模型下载时，按其官方要求设置网络环境。
# 模型缓存、下载源由第三方自身管理；Yorw 不自动指定镜像或下载 OCR 模型。
# 勿在此模板填写服务密钥；复制为 .env 也不会被 Yorw 自动读取。
```

> **安全设计说明**：应用运行时**故意不自动读取 `.env` 中的明文 API Key**，防止密钥随工作区日志、前端打包或代码提交泄漏。模型地址、模型名与密钥仅通过应用 `House` 页面录入（主进程经系统安全存储加密保存）；本地后端端口与随机 Bearer 会话令牌由 Electron 主进程在每次启动时动态协商注入。

---

## 10分钟极速复现指南（从零构建 MVP 应用）

本指南面向评委在**全新空目录**中验证“环境准备 + 核心提示词 → 生成可运行 MVP 应用”的完整过程。建议时间分配：**第 1 步环境初始化（约 1 分钟）→ 第 2 步 AI 生成最小全栈闭环（约 5–6 分钟）→ 第 3 步自动化测试与桌面持久化验收（约 3–4 分钟）**。

### 第 1 步（0–1 分钟）：初始化纯净空目录与环境变量模板

打开 PowerShell，在任意非 Yorw 仓库位置创建全新空目录，核验工具版本并写入 `.env.example`（**切勿复制 Yorw 仓库内的任何业务代码文件**）：

```powershell
New-Item -ItemType Directory yorw-mvp-rebuild
Set-Location yorw-mvp-rebuild
git init

# 核验基础工具链版本
node --version
pnpm.cmd --version
uv --version
uv python install 3.12.10

# 配置项目内隔离 uv 缓存目录并生成 .env.example 模板
$env:UV_CACHE_DIR = "$PWD/.cache/uv"
@"
UV_CACHE_DIR=.cache/uv
# 模型 API Base URL、模型名与 API Key 请在应用 House 页面配置，应用不自动读取明文 .env 密钥。
# Electron 工作区路径、127.0.0.1 动态端口与随机会话令牌由主进程启动时自动注入管理。
"@ | Set-Content -Encoding UTF8 .env.example
```

### 第 2 步（1–7 分钟）：输入核心生成提示词构建 MVP

在 `yorw-mvp-rebuild` 目录中启动你的 AI 编程助手，将以下提炼自本项目真实开发约束与架构契约的**核心生成提示词**完整粘贴发送：

#### 核心提示词 A：零基础构建 Yorw MVP 全栈应用

> 请在当前空目录从零构建 Windows 本地优先科研阅读与知识工作区 MVP，命名为 **知栖 Yorw**。先简要列出目录结构、进程通信契约、SQLite 表结构与验收命令，随后直接编写完整代码、生成依赖锁文件并运行自检，不要只输出伪代码片段。
>
> **1. 技术栈与工程结构**
> - 采用 pnpm monorepo：`apps/desktop`（Electron + electron-vite + React 19 + TypeScript）与 `services/api`（Python 3.12 + FastAPI + Pydantic + Uvicorn + pypdf + 标准库 sqlite3/FTS5，由 `uv` 管理）。
> - 根目录 `package.json` 提供 `dev`、`typecheck`、`test`、`build` 脚本；桌面测试使用 `vitest`，后端测试使用 `pytest`，并提供脚本 `scripts/make-mvp-fixtures.py` 在临时目录生成至少两页可检索文字的自编写测试 PDF（第一页含 `Yorw fixed English fixture evidence.`，第二页含补充段落）。保留当前 `.env.example`，不自动从 `.env` 加载虚构 API Key。
>
> **2. 产品文化命名与交互体验**
> - 顶部固定保留 **Storage**、**Garden**、**House** 三个一级空间名称（不得替换为通用名称），采用清爽学术蓝白界面（冷灰背景 `#F4F6F9`、纯白卡片 `#FFFFFF`、深蓝主色 `#3158C9`），清晰展示后端连接状态与 AI 处理阶段提示（如“正在查找原文…”“正在生成…”）。
> - **Storage**：通过 Electron 原生文件对话框导入本地 PDF，主进程将原件复制到受管工作区并按 SHA256 去重；使用 `PDF.js` 按物理页码翻页阅读原件，后端用 `pypdf` 抽取逐页文本存入 SQLite；右侧支持按文献编辑、保存阅读笔记，并支持针对当前文献的关键词检索与带页码引用的问答。
> - **Garden**：支持创建层级研究专题（Topic），编辑并保存专题 Markdown 正文，保留不可变历史修订（Revision）与版本号；支持基于选定文献/笔记生成专题候选草稿预览，用户必须显式点击“采纳写入”并校验基础版本号（`base_revision_id` / `version`）后才更新正式专题正文，版本过期返回 `409` 拒绝覆盖。
> - **House**：展示当前本地工作区数据路径，提供兼容 OpenAI Chat Completions 的 `API Base URL / 模型名 / API Key` 配置表单与连接测试；API Key 由 Electron 主进程经 `safeStorage`（测试环境提供受控加密回退）保存在本地密文文件，绝不传给 renderer 或写入 SQLite 明文。未配置模型密钥时不阻断导入、阅读、笔记、检索与手工专题编辑，并提供明确标记的“本地确定性协议夹具模式”以便无密钥环境下完整验证带引用问答与草稿采纳闭环。
>
> **3. 安全架构与代码硬约束**
> - 严格遵循 `React renderer → preload 类型化白名单 IPC → Electron main → 127.0.0.1 动态端口 FastAPI → SQLite` 调用链。
> - `renderer` 开启 `contextIsolation: true` 与 `sandbox: true`，关闭 `nodeIntegration`，禁止暴露任意文件路径读写、任意 HTTP 转发或任意命令执行。
> - `main` 启动 Python 后端时注入随机 Bearer 会话令牌并执行 `/health` 握手，应用退出时可靠回收后端子进程、不留僵尸进程。
> - SQLite 为全部业务数据的唯一权威存储，全部 SQL 参数化查询，启动时自动按序执行初始化迁移；所有自动化测试必须使用隔离临时目录，不得污染真实用户数据，不得设置无上限轮询死循环。运行失败时必须先定位根因修复，严禁删除或弱化测试断言过关。

#### 核心提示词 B：编译或联调异常时的最小闭环纠偏提示词（按需追加）

若首轮生成遇到依赖、端口握手或测试报错，直接追加以下受控纠偏提示词：

> 请先读取报错日志、实际文件与前后端接口契约，说明失败输入、预期行为与实际结果。仅针对当前 MVP 最小闭环修复根因，保留已有持久化逻辑与测试覆盖，补充一个能复现刚才报错的回归测试后重新运行 `pnpm typecheck`、`pnpm test` 与 `pytest`。严禁扩大无关功能范围，严禁用内存数组或静态假页面冒充 SQLite 持久化。

### 第 3 步（7–10 分钟）：运行测试与 6 项桌面闭环验收

在 `yorw-mvp-rebuild` 根目录依次执行依赖锁定、自动化测试、测试夹具生成与桌面启动：

```powershell
$env:UV_CACHE_DIR = "$PWD/.cache/uv"

# 1. 首次安装并生成当前 MVP 项目自己的锁文件（随后即可使用 --frozen-lockfile / --locked 复跑）
pnpm.cmd install
uv sync --project services/api

# 2. 静态类型检查与前后端自动化测试
pnpm.cmd typecheck
pnpm.cmd test
uv run --project services/api pytest -q

# 3. 生成自编写两页测试 PDF 夹具并启动桌面应用
uv run --project services/api python scripts/make-mvp-fixtures.py .cache/mvp-fixtures
pnpm.cmd dev
```

桌面窗口启动后，按以下 **6 项契约清单** 完成验收并记录结果（任意一项缺失视为未完成重建，不得以截图或静态 HTTP 200 代替）：

1. **进程握手与界面结构**：顶部存在 `Storage / Garden / House` 蓝白导航，本地服务显示已就绪，渲染进程控制台无 `require`/`process` 暴露。
2. **PDF 导入与多页原件阅读**：在 `Storage` 导入 `.cache/mvp-fixtures` 下的两页测试 PDF，通过 `PDF.js` 正常阅读第 1 页与第 2 页原文。
3. **文献笔记保存**：在当前文献笔记区输入“十分钟 MVP 复现笔记”并保存，切换空间再返回后内容仍在。
4. **可核查页码引用与无证据拒答**：对当前文献提问（可使用 `House` 配置的真实模型或显式标记的本地协议夹具），验证回答中的 `[S1]` 引用对应真实物理页码；提问文档中不存在的无关事实，必须明确提示缺少原文依据、不捏造引用页码。
5. **Garden 专题预览采纳与版本冲突拦截**：在 `Garden` 新建专题并生成候选草稿；验证未点击采纳前正式正文不变，若先手工修改并保存正式正文、再尝试采纳基于旧版本生成的草稿，服务端明确拒绝过期覆盖。
6. **重启持久化与进程回收**：正常关闭窗口，确认后台无残留 Python 进程；再次执行 `pnpm.cmd dev`，已导入文献、阅读笔记与专题正文全部完整恢复。

---

## 成品仓库（v0.4.0）源码锁定复跑指南

本节用于在现有 Yorw 仓库上精确复跑完整的 **v0.4.0** 应用、体验进阶功能（多格式原件预览、逻辑文献目录、元数据 AI 整理、研究助理受限工具循环、研究记忆与协作修改方案部分采纳）并运行全量回归测试。

### 1. 获取源码与锁定启动

完成上方[环境配置说明](#1-环境配置说明)后，在 PowerShell 执行以下命令（若已在当前提交材料工作区中，跳过前三条 `git clone / Set-Location / checkout`，避免覆盖未提交工作树）：

```powershell
git clone https://github.com/Osak0/Yorw.git
Set-Location Yorw
git checkout feature/ai-cowork-in-garden
git rev-parse HEAD

$env:UV_CACHE_DIR = "$PWD/.cache/uv"
uv python install 3.12.10
pnpm.cmd install --frozen-lockfile
uv sync --project services/api --locked

# 生成可公开复用的自编写测试样例（输出目录须尚不存在；重复生成时更换子目录名）
services/api/.venv/Scripts/python.exe scripts/make-mvp-fixtures.py .cache/quickstart-fixtures
pnpm.cmd dev
```

预期弹出“知栖 Yorw”窗口，顶部可切换 `Storage / Garden / House`，本地后端自动握手进入已连接状态（无需另开终端手动运行 `uvicorn`；开发态使用隔离的 `Yorw-development` 数据目录，不会污染正式安装版数据）。

### 2. 快速核验 v0.4.0 核心工作流

1. **Storage 导入、逻辑目录与原件阅读**：在 `Storage` 点击左侧“导入文献”，选择 `.cache/quickstart-fixtures/fixture.pdf`（支持新建文件夹、单击展开层级、双击进入目录、右键管理）。点击“打开阅读”查看两页原文，在右侧保存“这是复现笔记”；也可关闭 `House` 语义检索后直接本地搜索 `English fixture evidence` 并点击结果跳回第 1 页高亮。
2. **House 模型与双项能力检测（可选 AI 流程）**：在 `House` 配置“聊天模型”“检索”以及新增的“研究助理模型”（填入服务商 API Base URL、模型名与 API Key，Base URL 不含 `/chat/completions` 或 `/embeddings`），分别执行**聊天连接测试**与**工具闭环检测**（使用自编写探针检测检索、读取与引用，不发送用户真实论文）。
3. **带来源问答、Garden 研究助理与方案部分采纳**：
   - 在文献阅读器提问“请说明本页提供的英文证据，并引用来源”，点击回答下方的 `[S1]` 页码按钮核查原文高亮。
   - 进入 `Garden` 打开“研究助理”，选择工作区或指定专题范围提问（支持新建会话分区、在“研究记忆”中查看研究轨迹或添加研究指引/内联纠正），观察实时工具阶段提示与回复下方的**可点击资料导航卡片**。
   - 让研究助理将讨论整理为新专题或笔记，点击方案卡片进入独立**修改方案详情页**，核查正文差异、前置依赖与来源，勾选部分或全部操作完成原子采纳，并可体验“撤回本次采纳”及人工补写后的防覆盖冲突保护。
4. **重启恢复与快照导出**：关闭应用后重新执行 `pnpm.cmd dev`，确认文献、笔记、专题、会话与工作标签完整恢复；在 `House → 数据与导出` 选择笔记或专题导出 ZIP 快照（含 Markdown 正文与独立来源清单，注意该导出不含全部原始 PDF 副本，不等同于完整工作区物理备份）。

### 3. 可选外部解析组件与常见启动排障

- **可选外部组件边界**：`Docling`（用于主动选择的增强解析与扫描件 OCR）和 `LibreOffice`（用于旧 `.doc` 转换与主动选择的 Word 版式 PDF 预览）由用户在独立环境中按需安装，并在 `House → 文献解析与预览` 通过原生对话框选择授权与能力检测，绝不静默装入 Yorw 自身环境。内置 PDF、DOCX、MD、TXT 阅读无需安装这两个组件。
- **全量回归与构建命令**：完整类型检查、106 项桌面测试、PyInstaller 冻结后端重建、439 项后端测试及原生隔离窗口烟测命令统一见 [开发指南](docs/development.md)（注意：涉及后端修改时须先执行 `pnpm.cmd build:backend` 再运行完整 `pytest`，确保冻结二进制与源码同步验证）。

| 常见现象 | 排查与处理方式 |
| --- | --- |
| 提示找不到 `node`、`pnpm` 或 `uv` | 完成一次性环境安装后重启终端；若 PowerShell 阻止 `.ps1` 脚本，改用 `pnpm.cmd`。 |
| 依赖下载中断或网络超时 | 检查网络后沿用原锁文件重试安装，保留完整报错日志；不要通过擅自升级依赖版本绕过网络问题。 |
| 生成样例提示目标目录已存在 | 为保护已有测试证据，生成器拒绝覆盖既有目录；请更换一个新的 `.cache/<目录名>`。 |
| 窗口提示本地服务未连接 | 确认已在仓库根目录执行 `uv sync --project services/api --locked` 且存在 `services/api/.venv/Scripts/python.exe`。 |
| 专题 AI 优化提示材料范围为空 | 默认范围限定为“当前专题及子专题”；请先在专题中关联文献/笔记，或显式切换为全工作区范围。 |
| 研究助理提示工具能力未验证或鉴权失败 | 在 `House → 研究助理模型` 检查 Base URL、模型名与 API Key，保存后先通过“工具能力检测”。 |

---

## 开发协作中的核心提示词模板

以下四段提示词概括了本项目从 `v0.1.0` 到 `v0.4.0` 约束 AI 编程助手的真实协作范式（完整原始会话与纯对话提取稿保存在提交材料外层 [`ai-cowork-history/`](../ai-cowork-history/) 及 [`提取结果/Yorw/`](../ai-cowork-history/提取结果/Yorw/)，逐轮审查案例与消息编号索引详见 [技术文档](docs/technical-report.md)）：

> **【上下文对齐与阶段门禁】** 请先只读浏览 `README.md`、`PLAN.md`、`AGENTS.md` 与本阶段涉及的模块代码，核对当前 Git 分支与工作区状态；明确本阶段目标、输入输出、数据契约与验收门槛后先向我确认（回复 `ok` 或提出疑问）。严格在当前授权阶段内实施，完成代码、自动化验证与文档同步后停下等待我 review，通过后再进入下一阶段。

> **【架构解耦与外部依赖隔离】** 基础阅读与内置格式解析必须在不安装可选外部组件、不配置云端模型密钥时正常可用。内置实现与第三方重组件（Docling、LibreOffice、OCR）通过统一 `yorw_api.parsing` 接口和注册表接入，外部组件不得装入项目 `.venv` 或污染 `uv.lock`。SQLite 为唯一业务权威存储，迁移只追加不改写，升级前自动备份。

> **【AI 预览隔离与反例测试先行】** 应用内 AI 工具只能读取受限范围资料或生成修改方案预览，正式元数据、笔记和专题正文必须经用户显式勾选采纳并在单事务中校验乐观版本号与来源可用性。针对取消、流截断、范围变更、并发版本冲突、人工补写后撤回和重启恢复编写回归测试；区分确定性夹具测试与真实云模型效果，严禁删改断言过关。

> **【仓库洁癖与发布权限边界】** 完成阶段任务后清理无用探针，保留有效测试、夹具生成器、双锁文件与 `.cache` 验证证据；不自动执行 `git commit`、`push`、合并分支、打标签或远端发布，不接触真实用户私有资料与明文密钥。

---

## 文档与证据导航

| 文档 / 目录 | 核心内容与用途 |
| --- | --- |
| **[作品介绍 Word 版](docs/作品介绍.docx)** / [Markdown 源稿](docs/project-introduction.md) | **评委首读推荐**：项目详情与用法、核心亮点与交互精细度、演进与 AI 测试落地、关键技术与安全防死循环设计、6 张实机界面图、首次参赛与从 0 独立开发声明。 |
| **[技术文档 Word 版](docs/技术文档.docx)** / [Markdown 源稿](docs/technical-report.md) | **工程纵深阐述**：开发态/运行态双层意图控制策略、4 条带对话编号的核心 Prompt 迭代实证链、四层安全架构与代码约束防线、三层可复现性严密论证。 |
| [`../ai-cowork-history/`](../ai-cowork-history/) / [`提取结果/`](../ai-cowork-history/提取结果/README.md) | 提交材料外层完整保留的 Codex 与 Claude Code 原始开发会话导出及去噪纯对话提取稿索引。 |
| [PLAN](PLAN.md) / [v0.4.0 发布说明](docs/releases/v0.4.0.md) | 当前分支集成基线、439+106 项验证摘要、候选制品状态与正式发布检查清单。 |
| [产品约定](docs/product.md) / [现役架构](docs/architecture.md) | `Storage / Garden / House` 体验原则、现役进程通信、Schema 001–031 数据契约、检索与研究助理工作流。 |
| [开发指南](docs/development.md) / [使用指南](docs/user-guide.md) | 完整构建打包命令、全部原生窗口专项烟测入口、功能操作说明与异常处理边界。 |
| [开发历史总索引](docs/history/README.md) | 完整保留从早期视觉设计、[v0.1.0](docs/history/v0.1.0.md)、[v0.2.0](docs/history/v0.2.0.md)、[v0.3.0](docs/history/v0.3.0-phase1.md) 到 [v0.4.0 实施与整改记录](docs/history/v0.4.0.md)、[发布准备记录](docs/history/v0.4.0-release-preparation.md) 的全过程决策与排障证据。 |

后续 AI 编程助手请统一从 [AGENTS.md](AGENTS.md) 进入。

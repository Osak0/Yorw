# 知栖 Yorw

**Your own research workplace.**

知栖是面向个人研究者与科研学习者的本地优先阅读与知识工作区，希望将文献阅读、AI 讨论、笔记和专题 Wiki 连接起来，让研究中的认识持续积累，并能回到原文核查与修订。

> 项目已进入开发阶段：已支持本地文献导入、管理、PDF 阅读、Markdown 笔记、文献内检索及带来源问答；问答已通过 review，Wiki 等能力仍按计划开发。

## 产品背景

论文、笔记和 AI 对话常常分散在不同工具中，围绕一个研究问题形成的理解难以复用。知栖希望让阅读、讨论和知识整理在同一工作区连贯进行，同时保留用户判断，区分论文事实、个人观点与模型推断。

## 产品概览

**Storage、Garden、House** 是知栖三个界面的正式名称，也表达我们对科研工作区的理解：积累材料、培育知识，并拥有属于自己的研究空间。

- **Storage**：积累研究材料与阅读过程。在这里管理和阅读 PDF、记录笔记，与 AI 进行带来源的讨论，并回到原文核查证据。
- **Garden**：让理解逐渐长成知识体系。从选定的论文、笔记与讨论培育专题 Wiki，确认 AI 修改，保留来源和修订记录。
- **House**：安放自己的研究工作区。首版用于模型连接、本地数据位置与内容导出；个人资料与研究主题将在后续逐步完善。

首版聚焦：**导入论文 → 阅读与问答 → 保存笔记 → 生成并确认 Wiki 草稿 → 重启后继续使用。**

数据默认本地保存，但不等于完全离线：使用云端聊天或 embedding 服务时，相关文本需要发送至用户配置的服务商；两类模型分别配置。

## 计划技术栈

| 模块 | 选型 |
| --- | --- |
| 桌面应用 | Electron + electron-vite，Windows x64 优先 |
| 前端与界面 | React + TypeScript、Tailwind CSS、shadcn/ui、Lucide |
| 状态管理 | TanStack Query + 少量 Zustand |
| 本地后端 | Python 3.12 + FastAPI + Pydantic + Uvicorn |
| 阅读与编辑 | PDF.js + pypdf、CodeMirror 6 + Markdown 预览 |
| 存储与检索 | SQLite + 本地文件、FTS5 + 多语言 embedding + NumPy |
| 模型接入 | 可替换的聊天与 embedding 接口，用户自行配置 API |
| 工程与发布 | pnpm、uv、Vitest、pytest、PyInstaller、electron-builder |

## 项目文档

- [产品设计](product_design.md)：产品理念与设计基线。
- [开发计划](PLAN.md)：当前首版范围、分步实施与 review 验收规则。

## 开发与验证（Windows x64）

需要 Node 24、pnpm 11.25.0、uv 和 Python 3.12。仓库版本文件记录本次验证的补丁版本。

```powershell
$env:UV_CACHE_DIR = "$PWD/.cache/uv"
uv sync --project services/api --locked
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm typecheck`、`pnpm test` 检查桌面代码；`services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q` 验证后端。打包后端测试需要先执行 `pnpm build:backend`，否则该项明确跳过。

`pnpm package:win` 自动检查类型、构建桌面与 Python 后端，并生成 `release/desktop/` 中的未签名测试安装包；`pnpm package:dir` 生成可直接启动的分发目录。开发模式使用独立的 Yorw-development 数据目录。工作区位于 Electron userData 下的 `workspace/`，包含 SQLite 数据库、受管理文献、临时文件、日志和内部迁移备份；用户资料与安装资源分开保存。

工作区基础已加入 SQLite 迁移、启动校验和受管理文件存储；Storage 已支持 PDF 导入、去重、文字抽取、元数据编辑、移除，以及阅读器翻页、缩放与页码恢复；House 已实现模型配置与连接测试，Garden 尚待后续步骤实现。[步骤 2 验收记录](docs/dev-evidence/step-02.md) 与[步骤 3 验收记录](docs/dev-evidence/step-03.md) 包含验证范围和已知限制。各步骤的历史运行记录见对应验收文档；当前 review 程序为 `release/step9-review/win-unpacked/Yorw.exe`。

### House 模型连接

聊天预设 DeepSeek：API Base URL 为 `https://api.deepseek.com`，模型名为 `deepseek-flash`（按 [DeepSeek 官方文档](https://api-docs.deepseek.com/) 于 2026-10-23 核对）。可编辑为其他兼容 Chat Completions 的服务。embedding 使用独立的地址、模型和密钥，需服务支持 `/embeddings`。

运行 `pnpm dev` 后进入 House，在本地输入 API Key，保存后点击“测试已保存配置”；测试可能产生少量 API 费用。密钥由 Electron 系统安全存储加密保存，不回显、不写入 SQLite。首次缺配置、服务鉴权失败、限流、超时均有提示。2026-10-23 用户已完成 DeepSeek 接入验收，并确认服务商平台显示用量请求；智谱 embedding-3 已在步骤 8 完成本地接入并通过用户 review。详见[步骤 4 验收记录](docs/dev-evidence/step-04.md)。

### Storage 文献库

在 Storage 点击“导入 PDF”，通过系统对话框选择单个文件。导入后保留受管副本，按 SHA-256 去重，并在后台按物理页抽取文字；列表显示进度与结果，可编辑标题、作者、年份，停止或重新抽取，或移除文献。未知元数据保持为空，不从文件名推测作者和年份。

本步上限为每文件 50 MiB、2000 页；不包含 OCR 或解密。加密、损坏、无文本和部分抽取会分别提示；移除仅处理受管副本及片段，原始选中文件不受影响。重启可继续访问已导入记录。步骤 5 已通过用户 review；本步程序位于 `release/step5-review/win-unpacked/Yorw.exe`。[步骤 5 验收记录](docs/dev-evidence/step-05.md) 包含运行入口和验证范围。

### PDF 阅读

在 Storage 点击“打开阅读”，可翻页、输入物理页码、切换缩放或适合宽度，并选择原文文字。当前页渲染完成后保存页码，重新打开或重启后恢复；保存失败会提示，不影响已载入页面的阅读。抽取不完整、无文本或尚未就绪的文献仍可尝试阅读，但不因此视为 AI 已获取完整原文。

阅读使用本地打包的 PDF.js，无需为阅读器配置模型服务。暂不提供解密、批注、PDF 内搜索或精确引用高亮；恢复的是物理页码，不包含缩放和页内滚动位置。步骤 6 已通过用户 review；本步程序位于 `release/step6-review/win-unpacked/Yorw.exe`。详见[步骤 6 验收记录](docs/dev-evidence/step-06.md)。

### 文献笔记

打开 Storage 中的文献，点击“笔记”即可新建多条 Markdown 笔记，切换编辑与预览，点击“保存笔记”或在编辑器内按 Ctrl+S 保存。宽窗口支持拖动或用方向键调整侧栏宽度，窄窗口通过覆盖面板编辑，Escape 可关闭。

已保存内容存入本地 SQLite，重新打开文献或重启后可继续编辑；未保存草稿按文献在本次会话中保留，关闭应用会提示确认。保存失败或版本冲突不会覆盖草稿，可重试或比较已保存版本。草稿尚无崩溃恢复能力，重要内容请及时保存。预览支持基础 Markdown 与表格，不加载原始 HTML、图片或可点击外链；关联文献不等于具有已验证的原文引用。步骤 7 已合并 main，详见[验收记录](docs/dev-evidence/step-07.md)。

### 文献内检索

在 Storage 阅读工具栏直接点击“检索”，查找当前文献的原文片段和物理页。关键词检索在本地运行；语义索引可独立使用 House 中的智谱 `embedding-3` 预设或兼容服务。语义建索引前需确认发送当前文献全部已抽取文字分块；启用语义查询会发送本次查询，可能产生费用。

缺配置、缺密钥或服务失败时明确降级为关键词；模型配置变化后需重建语义索引。候选片段不等于答案，关键词模式不保证中文能召回英文原文。步骤 8 已通过用户 review；详见[步骤 8 记录](docs/dev-evidence/step-08.md)。

语义候选支持输入 0–1 之间自定义最低余弦相似度（如 0.255）并显示实际分数；默认 0.50 是待模型校准的初始筛选值，相似度不代表事实可信度。

关键词命中或语义相似度达到自定义阈值，满足任一条件即展示；只有两者都不满足时才无结果。阈值仅过滤语义候选。

### 文献问答

在阅读工具栏点击“问答”，输入问题，准备并勾选原文证据，核对聊天服务与发送范围后生成。回答逐步显示并本地保存；支持取消、重新准备证据后重试、点击有效引用跳至物理页，以及转存为保留引用快照的笔记。只发送本次问题和选定证据，不自动发送历史对话。没有证据时不调用聊天模型。

引用仅说明材料来源，不保证回答正确；无效引用、服务失败、中断及来源失效均有提示。2026-10-24 用户已使用 DeepSeek 完成 Step 9 review，详见[步骤 9 记录](docs/dev-evidence/step-09.md)。

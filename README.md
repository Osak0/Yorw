# 知栖 Yorw

**Your own research workplace.**

知栖是面向个人研究者与科研学习者的本地优先阅读与知识工作区，希望将文献阅读、AI 讨论、笔记和专题 Wiki 连接起来，让研究中的认识持续积累，并能回到原文核查与修订。

> 项目已进入开发阶段：桌面与本地服务骨架已接通，文献、问答与 Wiki 等产品能力仍按计划实现。

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

工作区基础已加入 SQLite 迁移、启动校验和受管理文件存储；Storage 已支持 PDF 导入、去重、文字抽取、元数据编辑和移除；House 已实现模型配置与连接测试，Garden 与具体阅读界面仍待后续实现。[步骤 2 验收记录](docs/dev-evidence/step-02.md) 与[步骤 3 验收记录](docs/dev-evidence/step-03.md) 包含验证范围和已知限制。步骤 3 已通过 review；步骤 3 验证分发目录为 `release/step3/`，默认 `release/desktop/` 的旧文件占用问题尚未确认原因，重建方式见步骤 3 记录。

### House 模型连接

聊天预设 DeepSeek：API Base URL 为 `https://api.deepseek.com`，模型名为 `deepseek-flash`（按 [DeepSeek 官方文档](https://api-docs.deepseek.com/) 于 2026-10-23 核对）。可编辑为其他兼容 Chat Completions 的服务。embedding 使用独立的地址、模型和密钥，需服务支持 `/embeddings`。

运行 `pnpm dev` 后进入 House，在本地输入 API Key，保存后点击“测试已保存配置”；测试可能产生少量 API 费用。密钥由 Electron 系统安全存储加密保存，不回显、不写入 SQLite。首次缺配置、服务鉴权失败、限流、超时均有提示。2026-10-23 用户已完成 DeepSeek 接入验收，并确认服务商平台显示用量请求；embedding 的真实服务连通性仍待验证。详见[步骤 4 验收记录](docs/dev-evidence/step-04.md)。

### Storage 文献库

在 Storage 点击“导入 PDF”，通过系统对话框选择单个文件。导入后保留受管副本，按 SHA-256 去重，并在后台按物理页抽取文字；列表显示进度与结果，可编辑标题、作者、年份，停止或重新抽取，或移除文献。未知元数据保持为空，不从文件名推测作者和年份。

本步上限为每文件 50 MiB、2000 页；不包含 OCR、解密或 PDF 阅读器。加密、损坏、无文本和部分抽取会分别提示；移除仅处理受管副本及片段，原始选中文件不受影响。重启可继续访问已导入记录。步骤 5 已通过用户 review；本步程序位于 `release/step5-review/win-unpacked/Yorw.exe`。[步骤 5 验收记录](docs/dev-evidence/step-05.md) 包含运行入口和验证范围。

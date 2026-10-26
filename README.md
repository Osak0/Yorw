# 知栖 Yorw

**Your own research workplace.**

知栖是面向个人研究者与科研学习者的本地优先阅读与知识工作区，把文献阅读、带来源的 AI 讨论、笔记和专题 Wiki 连接起来，让认识持续积累，并能回到原文核查。

论文、笔记和 AI 对话常常分散在不同工具中。知栖围绕研究主题整理这些材料，同时保留用户判断，区分论文事实、个人观点与模型推断。

## 三个属于知栖的空间

- **Storage**：积累研究材料与阅读过程。导入和管理 PDF、阅读与检索原文、记录 Markdown 笔记，进行带来源的问答。
- **Garden**：让理解逐渐长成知识体系。描述要求后，从文献、笔记和 Wiki 自动整理草稿；编辑后追加或替换当前 Wiki，保留来源与修订，支持历史回退。
- **House**：安放自己的研究工作区。分别配置聊天与 embedding 服务、查看数据位置，导出已保存笔记与 Wiki 的 Markdown 和来源清单。

当前开发版流程：**导入论文 → 搜索与问答 → 保存笔记 → 描述要求生成 Wiki 草稿 → 编辑采纳 → 导出与重启继续。**

数据默认本地保存，但不等于完全离线：使用云端聊天或 embedding 时，相关文本发送至用户配置的服务商，可能计费。内容导出也不等于完整备份。

## v0.2.0 本机 review 版

2026-10-26 · 三项 AI 流程改进已实现，等待用户 review。搜索自动结合关键词与语义召回，展示短原文和跳页入口；问答自动准备材料并支持追问；Garden 自动选材、生成可编辑草稿。House 可关闭默认开启的语义检索。

本机程序位于完整 `release/v0.2.0-review/win-unpacked/` 目录，安装器为 `release/v0.2.0-review/Yorw-Setup-0.2.0-x64.exe`。详见[发布说明](docs/releases/v0.2.0.md)、[完整验证记录](docs/dev-evidence/v0.2.0-completion.md)及[使用指南](docs/user-guide.md)。尚未合并或公开发布；真实模型质量等待用户在 House 配置后验收。

## v0.1.0 历史发布

Windows x64 · 0.1.0。2026-10-25 本机 MVP 已通过步骤 14 review，已合并 main 并发布 [v0.1.0 预发布版本](https://github.com/Osak0/Yorw/releases/tag/v0.1.0)。按照用户选择，干净 Windows 机器的验收暂未执行。

- 下载：[v0.1.0 发布页](https://github.com/Osak0/Yorw/releases/tag/v0.1.0)，安装器为 `Yorw-Setup-0.1.0-x64.exe`，已核对与步骤 14 验收包的 SHA256 一致。
- 直接运行：完整 `release/step14-review/win-unpacked/` 目录中的 `Yorw.exe`，不能只复制单个 exe。
- [v0.1.0 发布说明](docs/releases/v0.1.0.md)保留该版验收与发布证据；当前[使用指南](docs/user-guide.md)和[已知限制](docs/known-limitations.md)面向 v0.2.0。

本版未签名。分发目录附带使用文档、自编写样例和 SHA-256 清单；本机验证不等同于所有 Windows 环境均已通过。

## 当前技术栈

| 模块 | 已使用组件 |
| --- | --- |
| 桌面与界面 | Electron + electron-vite、React + TypeScript、CSS |
| 本地后端 | Python 3.12 + FastAPI + Pydantic + Uvicorn |
| 阅读与编辑 | PDF.js + pypdf、CodeMirror 6 + Markdown 预览 |
| 存储与检索 | SQLite + 本地文件、FTS5 + embedding + NumPy |
| 模型接入 | 独立的聊天与 embedding 配置、兼容 API；用户自行提供密钥 |
| 工程与分发 | pnpm、uv、Vitest、pytest、PyInstaller、electron-builder / NSIS |

## 项目与开发文档

[产品设计](product_design.md)保存设计基线；[开发计划](PLAN.md)记录当前范围、状态与后置功能；[工程与验证记录索引](docs/dev-evidence/README.md)提供复现入口；[v0.1.0 发布说明](docs/releases/v0.1.0.md)记录发布状态与验证边界。

开发需 Node 24、pnpm 11.25.0、uv 和 Python 3.12，精确版本见仓库版本文件与锁文件。

```powershell
$env:UV_CACHE_DIR = "$PWD/.cache/uv"
uv sync --project services/api --locked
pnpm install --frozen-lockfile
pnpm dev
```

开发模式使用独立的 Yorw-development 工作区。`pnpm typecheck`、`pnpm test` 检查桌面；`services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q` 验证后端。`pnpm package:win` 构建未签名安装包；打包和完整流程复现见[步骤 14 记录](docs/dev-evidence/step-14.md)。

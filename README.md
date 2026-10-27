# 知栖 Yorw

**Your own research workplace.** Windows 本地优先的科研阅读与知识工作区，将文献、带来源问答、笔记和专题 Wiki 连接起来。

- **Storage**：批量导入 PDF，以目录和搜索管理文献；阅读、检索、问答与笔记可在侧栏或独立标签中使用，资料页集中管理元数据和关系。
- **Garden**：组织专题与关联文献，编辑 Wiki；AI 默认根据当前专题及子专题材料生成可编辑草稿，由用户追加或替换并保留修订。
- **House**：配置聊天与检索服务、语义检索偏好，查看数据位置并导出已保存内容。

## 当前状态

**v0.2.0 发布准备中，schema 15。** 原定 v0.2.1 的工作区改进（阶段 A/B/C，步骤 1–12）统一纳入 v0.2.0，不单独发布 v0.2.1。阶段 A/B 已合并 main；阶段 C 用户 review 通过，暂存于 `feature/ai-material-scope`，本次仓库整理仍待审查、提交和合并。用户确认此前 v0.2.0 未发布，本次不创建标签或 GitHub Release。

变化与候选包状态见 [v0.2.0 发布说明](docs/releases/v0.2.0.md)，使用与能力边界见[使用指南](docs/user-guide.md)。真实模型逐题质量及独立干净 Windows 验收仍待补充。数据默认本地保存，云端模型会接收任务所需文本；内容导出不是完整备份。

## 快速开发

需要 Node 24、pnpm 11.25.0、Python 3.12 和 uv。仓库根目录执行：

```powershell
$env:UV_CACHE_DIR = "$PWD/.cache/uv"
pnpm install --frozen-lockfile
uv sync --project services/api --locked
pnpm dev
```

开发环境使用独立工作区。完整验证、打包与复现命令只维护在[开发指南](docs/development.md)。技术栈：Electron/electron-vite、React/TypeScript/CSS、FastAPI/SQLite、PDF.js/pypdf、CodeMirror、FTS5/embedding/NumPy；依赖由 pnpm/uv 锁定。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [PLAN](PLAN.md) | 当前集成状态、发布前待办和后置范围。 |
| [产品约定](docs/product.md) | 三个空间、体验原则与视觉。 |
| [架构](docs/architecture.md) | 现役模块、数据、来源和 AI 工作流。 |
| [开发指南](docs/development.md) | 环境、回归、打包与复现。 |
| [使用指南](docs/user-guide.md) | 使用方法、异常处理及能力边界。 |
| [v0.2.0](docs/releases/v0.2.0.md) / [v0.1.0](docs/releases/v0.1.0.md) | 版本变化和发布状态。 |
| [设计历史](docs/history/design.md) / [v0.1.0 开发记录](docs/history/v0.1.0.md) | 原始设计与 MVP 实施证据。 |
| [v0.2.0 AI 改进](docs/history/v0.2.0.md) / [工作区改进](docs/history/v0.2.0-workspace.md) | AI 流程和原 v0.2.1 计划、A/B/C 实施记录。 |
| [v0.2.0 发布准备](docs/history/v0.2.0-release-preparation.md) | 本轮整理、候选制品与验收证据。 |

后续 Agent 从 [AGENTS](AGENTS.md) 进入。历史是发生时的证据，无需全部作为当前开发指令加载。自动化测试、必要夹具和复现工具继续维护；测试 PDF、数据库、报告和制品在忽略目录中按需生成。

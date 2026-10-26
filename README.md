# 知栖 Yorw

**Your own research workplace.** 本地优先的科研阅读与知识工作区，将文献、带来源问答、笔记和专题 Wiki 连接起来。

- **Storage**：导入和阅读 PDF，搜索当前原文，提问并保存有来源的笔记。
- **Garden**：描述要求后自动选材、生成草稿；编辑后追加或替换 Wiki，保留修订与回退。
- **House**：独立配置聊天/检索服务、设置语义检索、查看数据位置并导出内容。

## 当前状态

v0.2.0 实现提交 `d68e364` 已随 PR #13 合并 main（`2c31cae`）。本地有 v0.1.0 标签；本轮未核查 v0.2.0 的公开 Release，不把代码合并等同于公开发布。真实模型质量及独立干净 Windows 验收仍待补充。

用户操作见[使用指南](docs/user-guide.md)，版本变化见 [v0.2.0](docs/releases/v0.2.0.md) / [v0.1.0](docs/releases/v0.1.0.md)。数据默认本地保存，云端模型会接收任务所需文本；内容导出不是完整备份。

## 快速开发

需要 Node 24、pnpm 11.25.0、Python 3.12 和 uv。仓库根目录执行：

```powershell
$env:UV_CACHE_DIR = "$PWD/.cache/uv"
pnpm install --frozen-lockfile
uv sync --project services/api --locked
pnpm dev
```

开发环境使用独立工作区。完整验证和打包命令仅维护在[开发指南](docs/development.md)；技术栈为 Electron/electron-vite + React/TypeScript/CSS，Python/FastAPI + SQLite，PDF.js/pypdf、CodeMirror、FTS5/embedding/NumPy，采用 pnpm/uv 锁定依赖。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [PLAN](PLAN.md) | 当前进度、下一步和后置范围。 |
| [产品约定](docs/product.md) | 三个空间、体验原则与视觉文化。 |
| [架构](docs/architecture.md) | 现役模块、通信、数据、来源和 AI 工作流。 |
| [开发指南](docs/development.md) | 环境、测试、构建、复现和交接。 |
| [使用指南](docs/user-guide.md) | 使用方法、异常处理及能力边界。 |
| [设计历史](docs/history/design.md) | 原始产品输入、计划和设计评审。 |
| [v0.1.0 开发记录](docs/history/v0.1.0.md) | 步骤 0–14 的原始验证与失败记录。 |
| [v0.2.0 开发记录](docs/history/v0.2.0.md) | 三阶段改进、恢复修复与完整验证证据。 |

后续 Agent 从 [AGENTS](AGENTS.md) 进入，不必将全部历史当作当前上下文。自动化测试与必要夹具保留；一次性 PDF、测试库、日志和制品按需生成，放在忽略目录中。

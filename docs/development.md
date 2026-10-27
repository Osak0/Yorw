# 开发与复现

当前范围见 [PLAN](../PLAN.md)，数据与接口约定见[架构](architecture.md)。历史记录是发生时的证据，不是当前命令清单。

## 环境与启动

Windows x64；Node 24（`.node-version`）、pnpm 11.25.0（根 packageManager）、Python 3.12（`services/api/.python-version`）和 uv。精确依赖以 `pnpm-lock.yaml`、`services/api/uv.lock` 为准，不为整理文档升级依赖。

仓库根目录执行：

```powershell
$env:UV_CACHE_DIR = "$PWD/.cache/uv"
pnpm install --frozen-lockfile
uv sync --project services/api --locked
pnpm dev
```

开发 profile 与正式应用隔离。不要把真实论文、数据目录、密钥或构建产物提交到 Git；`.cache/` 集中保存一次性样例、测试工作区和本地报告。`release/` 保留分发制品，不把它当源码。

## 验证与构建

```powershell
pnpm typecheck
pnpm test
pnpm build:backend
services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/<新测试目录>
pnpm build
pnpm --filter @yorw/desktop exec electron-builder --win nsis --x64 --config.directories.output=../../release/<本轮制品目录>
```

先构建后端再跑完整 pytest，才能覆盖冻结服务；若缺少冻结程序而跳过相应测试，必须报告跳过。`pnpm package:win` 可串行执行类型、前端、后端与安装器构建；`pnpm package:dir` 构建完整分发目录。打包目录含 `resources/backend/yorw-api` 和 `resources/help`；不依赖用户预装 Python/Node。未签名，没有自动更新。

两侧测试目录及 `services/api/tests/fixtures/retrieval.json` 是回归资产，不属于待删除的示例材料。样例 PDF 按需生成，不存进源码：

```powershell
services/api/.venv/Scripts/python.exe scripts/make-mvp-fixtures.py .cache/<新样例目录>
powershell -NoProfile -File scripts/verify-mvp.ps1 -Executable release/<本轮制品目录>/win-unpacked/Yorw.exe -ReportDirectory .cache/<新报告目录> -FixtureDirectory .cache/<新样例目录>
```

样例与报告目录必须尚不存在，保护历史证据。生成器提供 5 份自编写文字 PDF 和加密/空文本/损坏 3 份负例。验证脚本清理运行时环境覆盖，限制 PATH 为 Windows 目录，在隔离 profile 中运行检索跳页、连续问答、笔记、自动选材、追加/替换/回退、导出和服务中断/重启。

现役原生烟测保留 `ai-workflow-smoke.ts`、`workspace-tabs-smoke.ts` 与 main 中的启动/阅读探针；脚本使用 `--mvp-smoke`、`--mvp-resume-smoke` 兼容入口，仍可读取 v0.1.0 旧制品的报告协议。旧阶段专用 `--notes-smoke`、`--search-smoke`、`--chat-smoke`、`--garden-smoke`、`--suggestions-smoke`、`--review-export-smoke`、`--draft-recovery-smoke` 不再维护；复现旧版时检出对应历史提交，不在当前界面运行旧选择器。

工作区界面回归由 `workspace-tabs-smoke.ts` 驱动，均使用隔离的绝对 `--report-dir`、自编写 PDF 和本地 loopback 模型/SSE 夹具：

- `--tabs-smoke`：打开同一/不同文献和专题、展开和返回三个 Storage 工具、共享检索输入、标签去重、标题更新与键盘语义。
- `--tabs-resume-smoke`：恢复标签顺序、激活项、页码和侧栏模式。
- `--tabs-close-smoke`：未保存笔记的取消/保存关闭、关闭其他逐项确认与最终关闭。
- `--tabs-fault-smoke`：后端退出时保存失败保持标签打开。
- `--tabs-citation-smoke`：工具标签中的来源跳转到正确阅读标签和物理页；关闭阅读标签后可重新创建。
- `--tabs-chat-smoke`：长回答流式增长、自动跟随/回到最新、停止、重新回答、输入法组合输入和保存笔记。
- `--tabs-tool-resume-smoke`：工具标签重启恢复并返回阅读。
- `--tabs-resource-smoke`：阶段 B 文献资料/关系/专题材料；文献目录与本地搜索、整理文献独立标签及返回文献库；编辑标签和人工总结、关联专题、双向关联文献、笔记显示、从 Garden 添加专题文献，并检查 1280×720/1440×900 的资料与材料视图无横向溢出。与 `--tabs-smoke` 一样，报告目录需有 `fixture.pdf` 和 `fixture2.pdf`。
- `--ai-workflow-smoke`：阶段 C 默认专题范围与显式全库切换、一次多选的批量导入矩阵、整理文献标签打开/保存/重开和既有 AI 追加/替换/回退；空范围、范围变化及 HTTP 错误由后端 pytest 覆盖。报告目录需有 `fixture.pdf` 与 `fixtures/` 下的 5 份文字和 3 份负例。
- `--layout-smoke`：1280×720、1440×900 的聊天/Garden/工具视图、目录收起和 1024 窄覆盖侧栏；阅读布局循环另覆盖 1440×1024 与 1024×768。高 DPI 可在同一次运行传入 `--force-device-scale-factor=1.25`。

这些烟测输出 `desktop-smoke.json`、`layouts.json`、`layout-panels.json` 和截图；`--ai-workflow-smoke` 另输出 `ai-workflow-smoke.json`、`ai-state.json`、`ai-restart.json`，并覆盖 AI 优化的材料范围选择、一次多选批量导入、整理文献标签保存/重开和打包流程。夹具模型只证明界面、协议和持久化行为，不代表真实论文质量。

## 如何解读结果

- 源码单元/API、冻结服务、原生桌面流程和真实云模型质量分别记录。loopback 夹具只证明协议、来源、状态和持久化行为，不证明回答正确。
- 受限 PATH 是当前主机的分发检查，不等于独立干净 Windows。安装器版本号相同也不代表内容相同。
- 真实服务在 House 配置，不在聊天或报告放 key。选择合法代表性论文，为每题标注允许范围、预期证据/物理页或“资料无答案”，分别检查召回、回答与引用；保留失败和耗时，不编造准确率。
- 每轮记录源码提交或未提交树指纹、依赖锁、命令/结果、样例哈希、模型/提示词版本；分发记录安装器、完整目录、后端和 help 文件哈希。`base_commit` 不能代替未提交源码指纹。
- 已验证制品及唯一报告先保留。公开发布前核对标签、Release 资产和在线校验清单，避免误传同版本旧安装器；是否提交、合并、发布由用户明确决定。

## 文档职责与交接

| 文档 | 唯一职责 |
| --- | --- |
| README | 产品概览、快速启动和导航。 |
| PLAN | 当前合并状态、下一步与后置范围。 |
| AGENTS | 下次 Agent 必须遵循的少量开发约束。 |
| product / architecture | 产品文化与体验原则 / 当前数据和通信合同。 |
| development / user-guide | 开发复现 / 使用与能力边界。 |
| releases / history | 面向版本的变化与发布状态 / 当时的开发、失败和验证证据。 |

历史集中在[设计](history/design.md)、[v0.1.0](history/v0.1.0.md)、[v0.2.0 AI 改进](history/v0.2.0.md)和[v0.2.0 工作区改进](history/v0.2.0-workspace.md)。已完成计划和 A/B/C 原始记录保留路径、校验摘要与验证事实；历史命令及绝对路径不保证适用于当前源码或新克隆。

CLAUDE.md 导入 AGENTS.md 作为统一开发约束，不重复维护架构和命令。历史版本名 v0.2.1 仅用于说明原计划与旧验证现场，当前统一发布版本为 v0.2.0。

## v0.2.0 发布准备

当前版本号在根 package.json、桌面 package.json、Python pyproject.toml 和 uv.lock 中均为 0.2.0，SQLite schema 15。包内帮助固定为当前使用指南与 v0.2.0 发布说明。更新帮助后必须重新打包，不能上传旧 review 包。

1. 完成功能与文档 review，保留已验证源码树与依赖锁指纹。
2. 按上文重建前后端，运行类型、桌面与冻结后端回归；选择新的输出目录构建 NSIS 安装器和完整分发目录。
3. 使用新生成的自编写 PDF 对候选目录运行完整流程与恢复；核对包内帮助、后端、版本和 schema，记录安装器、可执行文件及分发目录各文件的 SHA256。
4. 合并后，确认目标提交与候选源码树一致；若源码、锁文件或包内帮助变化，重建并重新验证。标签应指向最终合并提交，不能仅凭同版本文件名选择资产。
5. 用户决定发布后上传对应安装器与 SHA256SUMS.txt；核对 GitHub Release 的标签、目标提交、资产和线上校验清单。公开发布及线上核验尚未完成时保持 pending。

本次候选输出与验证结果见[v0.2.0 发布说明](releases/v0.2.0.md)和[发布准备记录](history/v0.2.0-release-preparation.md)。该记录说明本机证据及未完成的验收，不代替真实模型质量、干净 Windows 或公开发布。

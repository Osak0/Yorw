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

现役原生烟测仅保留 `ai-workflow-smoke.ts` 与 main 中的启动/阅读探针；脚本使用 `--mvp-smoke`、`--mvp-resume-smoke` 兼容入口，仍可读取 v0.1.0 旧制品的报告协议。旧阶段专用 `--notes-smoke`、`--search-smoke`、`--chat-smoke`、`--garden-smoke`、`--suggestions-smoke`、`--review-export-smoke`、`--draft-recovery-smoke` 不再维护；复现旧版时检出对应历史提交，不在当前界面运行旧选择器。

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

历史已按[设计](history/design.md)、[v0.1.0](history/v0.1.0.md)、[v0.2.0](history/v0.2.0.md)归档合并，保留原记录标题、路径、校验摘要与测试事实。旧文件可用 `git show 2c31cae:<原路径>` 精确恢复；当前代码无需同时读取全部历史。

本次仓库整理从 main `2c31cae` 创建 `feature/action`，不改变业务行为、SQL、依赖、用户数据或既有发布包；移除重复说明和过时烟测入口，整合包内帮助资源。历史记录中的绝对路径和 `.cache` 报告只指本机旧验证现场，不保证新克隆存在。

2026-10-26 整理核验：Markdown 从 30 份收敛为 12 份，22 份原始记录合并为 3 份历史归档；每条记录保留原路径和 SHA256，可与基线 Git 内容核对。删除的手工体验清单没有执行结果，不作为质量证据保留；源代码测试、JSON 夹具、现役样例生成器与完整流程烟测继续维护。仓库整理不修改平台生成记忆，旧分支及忽略目录内的发布包/原始证据也不清场。

本轮通过类型检查、29 项桌面测试、生产构建、118 条本地文档链接和 15 项忽略规则检查。另在 `release/repository-cleanup-check/` 创建独立检查包，使用新生成的样例完成受限 PATH 下的完整流程与故障恢复（32.38 秒，schema 11）；报告位于 `.cache/repository-cleanup-proof/verification.json`。Python 业务、迁移及依赖没有改动，本轮未重跑完整后端回归，154 项属于 v0.2.0 历史交付证据。新检查包不是公开发布制品，不替代原验收包。

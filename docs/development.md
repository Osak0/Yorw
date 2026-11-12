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

若本机执行策略阻止 `build:backend`，可使用进程级 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-backend.ps1`；不修改全局策略。完整测试需允许子进程和 loopback HTTP，沙箱生命周期超时须先区分环境问题，不放宽断言。

两侧测试目录及 `services/api/tests/fixtures/retrieval.json` 是回归资产，不属于待删除的示例材料。样例 PDF 按需生成，不存进源码：

```powershell
services/api/.venv/Scripts/python.exe scripts/make-mvp-fixtures.py .cache/<新样例目录>
powershell -NoProfile -File scripts/verify-mvp.ps1 -Executable release/<本轮制品目录>/win-unpacked/Yorw.exe -ReportDirectory .cache/<新报告目录> -FixtureDirectory .cache/<新样例目录>
```

样例与报告目录必须尚不存在，保护历史证据。生成器提供 5 份自编写文字 PDF 和加密/空文本/损坏 3 份负例。验证脚本清理运行时环境覆盖，限制 PATH 为 Windows 目录，在隔离 profile 中运行检索跳页、连续问答、笔记、自动选材、追加/替换/回退、导出和服务中断/重启。

原生烟测源码保留 `ai-workflow-smoke.ts`、`workspace-tabs-smoke.ts` 与 main 中的启动/阅读探针；脚本使用 `--mvp-smoke`、`--mvp-resume-smoke` 兼容入口，仍可读取 v0.1.0 旧制品的报告协议。旧阶段专用 `--notes-smoke`、`--search-smoke`、`--chat-smoke`、`--garden-smoke`、`--suggestions-smoke`、`--review-export-smoke`、`--draft-recovery-smoke` 不再维护；复现旧版时检出对应历史提交，不在当前界面运行旧选择器。

工作区界面回归由 `workspace-tabs-smoke.ts` 驱动，均使用隔离的绝对 `--report-dir`、自编写 PDF 和本地 loopback 模型/SSE 夹具：

- `--tabs-smoke`：附加专题右键菜单回归（树、路径、正文侧栏、键盘唤起、取消/确认删除、子专题提升及相关标签关闭），输出 `topic-menu-smoke.json` 与 `topic-context-menu.png`；打开同一/不同文献和专题、展开和返回三个 Storage 工具、共享检索输入、标签去重、标题更新与键盘语义；同时覆盖 Garden 无侧栏首页、层级树打开、首页/正文默认父级、新建标签去重与草稿保留、新建/管理关闭保护、管理改名/移动与标签同步。
- `--tabs-resume-smoke`：恢复标签顺序、激活项、页码和侧栏模式。
- `--tabs-close-smoke`：未保存笔记的取消/保存关闭、关闭其他逐项确认与最终关闭；Garden 新建/管理标签的取消、放弃和创建关闭由 `--tabs-smoke` 覆盖。
- `--tabs-fault-smoke`：后端退出时保存失败保持标签打开。
- `--tabs-citation-smoke`：工具标签中的来源跳转到正确阅读标签和物理页；关闭阅读标签后可重新创建。
- `--tabs-chat-smoke`：长回答流式增长、自动跟随/回到最新、停止、重新回答、输入法组合输入和保存笔记。
- `--tabs-tool-resume-smoke`：工具标签重启恢复并返回阅读。
- `--tabs-resource-smoke`：旧资料聚合页选择器，当前页面已退役；保留源码及历史证据，现役管理流程改用下文 `--document-management-smoke`。
- `--ai-workflow-smoke`：保留全流程及恢复协议；其中旧整理页面选择器尚未在最终 v0.4.0 树重新验收，不将历史通过视为当前通过。发布前需要更新／核验后再执行完整流程，当前元数据／历史流程用下文专项覆盖。
- `--layout-smoke`：1280×720、1440×900 的聊天/Garden/工具视图、目录收起和 1024 窄覆盖侧栏；Garden 另覆盖 1024×768、层级树/路径列表、搜索祖先、展开/收起全部、长名称和当前项高亮，并保存首页层级树与路径视图截图（`garden-home-<宽×高>.png`、`garden-home-paths-1024x768.png`、`garden-home-paths-1280x720.png`）。阅读布局循环另覆盖 1440×1024 与 1024×768。高 DPI 可在同一次运行传入 `--force-device-scale-factor=1.25`。

这些烟测的报告协议包括 `desktop-smoke.json`、`layouts.json`、`layout-panels.json` 和截图；`--ai-workflow-smoke` 另输出 `ai-workflow-smoke.json`、`ai-state.json`、`ai-restart.json`，用于记录全流程及重启行为，旧页面选择器的当前适用性按上表说明，不将旧报告当作本轮全流程通过。夹具模型只证明界面、协议和持久化行为，不代表真实论文质量。

多格式及可选解析组件验证：

```powershell
services/api/.venv/Scripts/python.exe scripts/make-format-fixtures.py .cache/<新样例目录>
services/api/.venv/Scripts/python.exe scripts/verify-docling.py `
  --executable <用户安装的 docling.exe> `
  --libreoffice "C:\Program Files\LibreOffice\program\soffice.exe" `
  --samples .cache/<样例目录> --report .cache/<新报告>.json `
  --ocr-engine rapidocr --ocr-mode full_page
```

- `make-format-fixtures.py` 生成 DOCX、DOC、MD、TXT、文字 PDF 和扫描 PDF；目标目录必须不存在。
- 扫描 PDF 使用 Docling RapidOCR 时需要 `onnxruntime`；本机网络需设置 `HF_ENDPOINT=https://hf-mirror.com` 和 `HF_HUB_DISABLE_XET=1`，并在启动 Yorw 前保留这些环境变量。
- 打包窗口多格式烟测：`Yorw.exe --yorw-smoke --reader-smoke --builtin-reading-smoke --report-dir=<新绝对目录>`；报告目录需含 `fixture.docx`、`fixture.md`、`fixture.txt`。
- 随包冻结后端外部解析：`services/api/.venv/Scripts/python.exe scripts/verify-packaged-parsers.py --backend release/desktop/win-unpacked/resources/backend/yorw-api/yorw-api.exe --samples <样例目录> --report <新报告>.json --workspace <新工作区> --docling <docling.exe> --libreoffice <soffice.exe>`。

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

CLAUDE.md 导入 AGENTS.md 作为统一开发约束，不重复维护架构和命令。历史版本名 v0.2.1 仅用于说明被并入 v0.2.0 的原计划与旧验证现场。当前应用 0.3.0，已 review 通过的最终范围见 [v0.4.0 计划](../PLAN_v0_4_0.md)。

## 候选制品与发布流程

当前工作树起点为 c9a6cb2，HEAD 为 978f865，后续功能待用户提交；schema 23／应用 0.3.0；打包配置包含当前使用指南及 v0.3.0 发布说明。历史本地候选为 `release/v0.3.0-candidate-20261031`，记录见 [工作区历史](history/v0.3.0-workspace.md)。本轮未核验远端 Release。修改随包帮助后需重新打包并验证，不能按相同版本号混选旧包。

1. 完成功能与文档 review，保留已验证源码树与依赖锁指纹。
2. 按上文重建前后端，运行类型、桌面与冻结后端回归；选择新的输出目录构建 NSIS 安装器和完整分发目录。
3. 使用新生成的自编写 PDF 对候选目录运行完整流程与恢复；核对包内帮助、后端、版本和 schema，记录安装器、可执行文件及分发目录各文件的 SHA256。
4. 合并后，确认目标提交与候选源码树一致；若源码、锁文件或包内帮助变化，重建并重新验证。标签应指向最终合并提交，不能仅凭同版本文件名选择资产。
5. 用户决定发布后上传对应安装器与 SHA256SUMS.txt；核对 GitHub Release 的标签、目标提交、资产和线上校验清单。公开发布及线上核验尚未完成时保持 pending。

阶段一历史候选及 review 结论见[v0.3.0 阶段一记录](history/v0.3.0-phase1.md)；v0.2.0 的旧候选来源另见[历史发布准备](history/v0.2.0-release-preparation.md)。不要按相同应用版本号混选制品。



## 阶段验证记录入口

阶段专属说明已归并到 [多格式／解析记录](history/v0.3.0-phase1.md)、[整理与固定检索评估](history/v0.3.0-phase2.md)、[目录／UI／元数据与发布候选](history/v0.3.0-workspace.md)。其中旧状态按发生时保留；现役启动、构建及通用窗口命令以上文为准。v0.4.0 四阶段已由用户 review 通过，实际运行及未执行的验收项见 [开发记录](history/v0.4.0.md)，不沿用历史通过结论。

## 当前文献管理专项回归

先执行类型检查及前端构建；涉及后端改动时重建冻结后端。用 `make-mvp-fixtures.py` 创建新样例目录，再将所需 `fixture.pdf` 放到新的隔离报告目录（不使用用户工作区）。以下每项单独使用新的隔离报告目录，不能同时启用多个专项标志：

```powershell
apps/desktop/node_modules/.bin/electron.cmd apps/desktop/out/main/index.js --yorw-smoke --reader-smoke --document-management-smoke --report-dir=<新绝对目录>
apps/desktop/node_modules/.bin/electron.cmd apps/desktop/out/main/index.js --yorw-smoke --reader-smoke --metadata-review-smoke --report-dir=<另一新绝对目录>
apps/desktop/node_modules/.bin/electron.cmd apps/desktop/out/main/index.js --yorw-smoke --reader-smoke --history-layout-smoke --report-dir=<另一新绝对目录>
```

报告目录需预先放入自编写 `fixture.pdf`；这里的“新目录”指未有旧报告／运行数据的独立目录。启动读取样例后会在其中创建隔离 profile；不得用 `.cache` 旧验证目录复跑覆盖证据。

| 标志 | 输出与主要覆盖 |
| --- | --- |
| `--document-management-smoke` | `document-management-smoke.json`、`management-1024/1280/1440.png`：六入口、稳定位置、解析二级项、草稿切换、关闭保护与保存、renderer 重载恢复、取消／确认删除后标签清理。该流程会删除隔离测试文献，跳过末尾要求文献仍存在的通用截图循环。 |
| `--metadata-review-smoke` | `metadata-review-smoke.json`、`metadata-selection.png` 与三宽度底部截图：七栏、缺少信息、无勾选框、逐栏添加／替换、首次生成一次、重新进入复用、历史隐藏／恢复和长页底部。 |
| `--history-layout-smoke` | `history-layout-smoke.json` 与三宽度截图：阅读侧栏无历史、独立检索左栏／固定搜索／右结果、历史只读、空 Enter 清空但保留历史、问答顶栏搜索顺序、正文搜索和定位高亮消退。 |

全部使用自编写 PDF、本地 loopback SSE 模型夹具；不验证真实服务质量。完整端到端重启／旧库升级与安装器验收不能由专项窗口替代。后端 `test_enrichment.py` 覆盖结构化请求、有限修正、原子采纳、关系冲突／回滚及候选校验；当前已运行成绩和失败事实只记在[开发历史](history/v0.4.0.md)。

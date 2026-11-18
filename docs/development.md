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

CLAUDE.md 导入 AGENTS.md 作为统一开发约束，不重复维护架构和命令。历史版本名 v0.2.1 仅用于说明被并入 v0.2.0 的原计划与旧验证现场。当前应用 0.3.0，已 review 通过的最终范围见 [v0.4.0 计划](history/PLAN_v0_4_0.md#四阶段最终范围归档2026-11-15-合并)。

## 候选制品与发布流程

当前分支 feature/ai-cowork-in-garden 尚未合并 main，继续开发 v0.4.0；当前进度、review 与提交状态见 [PLAN](../PLAN.md)；schema 31／应用 0.3.0；打包配置包含当前使用指南及 v0.3.0 发布说明。历史本地候选为 `release/v0.3.0-candidate-20261031`，记录见 [工作区历史](history/v0.3.0-workspace.md)。本轮未核验远端 Release。修改随包帮助后需重新打包并验证，不能按相同版本号混选旧包。

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
| `--metadata-review-smoke` | `metadata-review-smoke.json`、`metadata-selection.png` 与三宽度底部截图：五个元数据字段与独立关系方案入口、缺少信息、元数据无勾选框、逐栏及全部添加／替换、取消确认、空建议跳过、首次生成一次、重新进入复用、历史隐藏／恢复和长页底部。 |
| `--history-layout-smoke` | `history-layout-smoke.json` 与三宽度截图：阅读侧栏无历史、独立检索左栏／固定搜索／右结果、历史只读、空 Enter 清空但保留历史、问答顶栏搜索顺序、正文搜索和定位高亮消退。 |

全部使用自编写 PDF、本地 loopback SSE 模型夹具；不验证真实服务质量。完整端到端重启／旧库升级与安装器验收不能由专项窗口替代。后端 `test_enrichment.py` 覆盖结构化请求、有限修正、原子采纳、关系冲突／回滚及候选校验；当前已运行成绩和失败事实只记在[开发历史](history/v0.4.0.md)。

连续阅读专项：同样的隔离启动参数加 `--continuous-reading-smoke`，报告目录需放置自编写至少 10 页 `fixture.pdf`（可将生成器的两页样例重复组合）。输出 `continuous-reading-smoke.json` 和 `continuous-reading-1024/1280/1440.png`，覆盖连续页交界、滚动同步页码、末页保存、上一页／直接跳页、侧栏开关、离屏画布释放与阅读高度。通用阅读探针按当前物理页查找画布，不依赖第一页始终挂载；不得使用真实用户资料运行烟测。

问答历史／PDF 高亮专项：`--yorw-smoke --reader-smoke --chat-memory-smoke --report-dir=<新绝对目录>`，目录预放自编写两页 fixture.pdf。输出 chat-memory-smoke.json、chat-memory.png、chat-memory-toolbar.png；本地 SSE 夹具先模拟有部分正文的截断，再验证“请回答完全”上下文、高亮、History.md 查看与固定导出。history-layout-smoke 同时核验 History.md 入口和精简导航。后端新增 test_chat_history.py 验证文献隔离、压缩回退、导出文件不作为输入、原文版本失效及空输出问题；test_completion_stream.py 捕获实际消息角色／输入预算。新增迁移后必须重建冻结服务再跑 pytest，当前 schema 版本见 PLAN。最终成绩与迭代失败只记入开发历史。

阅读导航专项：构建后使用 `--yorw-smoke --reader-smoke --reader-navigation-smoke --report-dir=<新绝对目录>`。目录预放至少 10 页自编写 fixture.pdf，英文依据置于页底并包含指向第 9 页的内置目录。输出 reader-navigation-smoke.json 和三宽度截图；验证段落可见、滚走不回跳、再次显式定位、外部点击清除、单页／连续、缩略图、目录和专注阅读／Esc。仅本地关键词检索，不调用模型。

阶段一模型专项：构建后运行 `--yorw-smoke --reader-smoke --model-profiles-smoke --report-dir=<新绝对目录>`，使用隔离工作区和本地自编写 SSE 服务，无需 PDF。输出 model-profiles-smoke.json、models-1024/1280/1440.png，核验加密存储、聊天、三轮工具闭环及设置页。真实请求仅在明确授权后追加 main 专用 --live-config=<只含地址和模型的JSON>、--live-key-file=<已有加密密钥文件>；密钥不在命令行或报告中明文出现，不自动读取用户论文。工具／配置专项为 test_model_profiles.py、test_tool_protocol.py；schema 25，完整回归先重建冻结服务。供应商工具协议依据 DeepSeek 官方 https://api-docs.deepseek.com/guides/tool_calls/ 与通用兼容协议；厂商能力仍须实际检测，不凭预设断言已实测。

阶段一已完成真实 DeepSeek deepseek-flash 的聊天与三轮工具闭环；Kimi／GLM／Qwen 仍需账号实测。若使用已有密文做独立隔离 profile 验证，需授权使用该密钥并同时提供其加密上下文；完成后清除隔离密钥副本和复制的 Local State，报告只保留脱敏诊断。

阶段二专项：构建后 `--yorw-smoke --reader-smoke --research-smoke --report-dir=<新绝对目录>`，目录预放自编写 fixture.pdf。输出 research-smoke.json 与 research-1024/1280/1440.png；本地 SSE 验证工具检测、Garden 空输入不创建会话、发送／检索读取／引用高亮、回答完成后出现的目录卡片定位 Storage 目录、文献卡片打开阅读器、手动恢复、关闭重开不重发。test_research.py 覆盖范围、幂等、归档删除、互斥、中文来源及事务读取；test_research_service.py 覆盖源码／冻结 HTTP 与重启无自动调用；test_reply_navigation.py 覆盖每次请求的结构概览、目录／专题范围过滤、卡片只取回答正文提到的对象且按出现顺序、运行中不显示卡片、文件名／路径／阅读笔记解析、伪造 ID 忽略、旧能力自述与实时结构、重复成功调用回放摘要、第三次重复终止、read_document 的 handle 与引用、证据结果压缩后保留引用编号、四篇文献加笔记预览在 10 轮与预算内完成、长目录任务的旧工具输出压缩及 token 预算。当前 schema 31，完整 pytest 前先重建冻结后端；不得自动用真实用户论文／密钥替代隔离夹具。

阶段三专项：`test_research_memory.py` 验证事务账本、来源／范围依赖、遗忘与重新引入、用户指引版本、预算、日限额／冷却、后台与前台并发及 26→27 备份升级；`test_research_memory_service.py` 使用本地 SSE 对源码／冻结服务验证模型摘要、遗忘、Markdown 导出与暂停重启。完整测试前重新 build:backend；PowerShell 执行策略受限时仅用上文进程级 Bypass。

现有 `--research-smoke` 同时覆盖记忆入口、指引保存、内联纠正、遗忘、活动、暂停与导出，新增 research-memory-smoke.json 和 research-memory-1024／1440.png。仍须预放自编写 fixture.pdf、使用新的 report-dir 隔离工作区与密钥；不读取真实数据，不把夹具成绩当成研究摘要质量。当前最终证据与失败复跑记录见 history/v0.4.0.md。


阶段四验证：test_notebooks.py 覆盖 27→28 备份迁移、空专题／旧草稿区分、重复启动、失败回滚、原始归属范围矩阵、共享去重、删除迁移和历史连续；test_notebook_ai.py 覆盖两类笔记优化的预览／人工采纳及旧版本保护；test_notebooks_service.py 对源码和冻结服务验 HTTP、范围和重启。

窗口验收使用新的绝对 report-dir：`--yorw-smoke --reader-smoke --notebooks-smoke --report-dir=<新目录>`，自生成本地 TXT／笔记与 SSE，不需要用户数据。成功后在同一目录以 `--notebooks-resume-smoke` 重启，核对笔记 ID、编辑器、阅读版本和不重发模型任务。输出 notebooks-smoke.json、notebooks-resume.json、三种宽度笔记截图、概览与文献笔记截图。早期窗口报告保留以记录选择器和异步保护修正，不冒充最终通过证据。最终命令与成绩见 history/v0.4.0.md。

### 阶段五验证入口

`test_collaboration.py` 覆盖 A01–A06 的来源失效、依赖取消、整组冲突、后续编辑及新增引用阻止撤回、纠正／遗忘／范围／会话失效，并验证事务注入失败无半成品、请求幂等、来源规范化与引用重排、两类笔记修订、候选正文命中与语义缓存开关、28→29 备份升级。`test_collaboration_service.py` 对源码与冻结服务验证真实 HTTP、重启、方案与决定持久化及撤回。

构建后使用全新的绝对目录执行 `--yorw-smoke --reader-smoke --collaboration-smoke --report-dir=<新目录>`；自生成文献和本地 SSE，无须预放论文或真实密钥。报告 `collaboration-smoke.json` 覆盖研究工具只预览、依赖取消、独立项采纳、普通关系不扩大范围、整组撤回及人工补写保护，并从文献整理入口生成新专题与文献关联。1024／1280／1440 截图验证布局。随后在相同目录以 `--collaboration-resume-smoke` 重启，输出 `collaboration-resume.json`，核对任务、决定、笔记、文献关联与不自动续发任务。

最终成绩、源码指纹及失败复跑记录见 [开发历史](history/v0.4.0.md)。仅本地夹具验证协议、事务与界面，不代表真实论文研究质量；安装器、独立干净 Windows 和发布另行验收。

### 阶段六综合回归

先按上文重建冻结后端，再运行完整 pytest、桌面测试、类型检查及前端构建。新增 `test_research_journey_service.py` 对源码和冻结后端执行同一跨专题 HTTP 闭环：自编写文献／共享笔记、显式选择与排除分支、检索读取原文、工具生成方案、纠正实验状态使旧方案失效、进程重启后继续原会话、纠正进入下一轮输入、部分采纳和幂等重试、人工补写阻止撤回、删除会话后正式成果保留、再次重启不自动调用模型。

```powershell
services/api/.venv/Scripts/python.exe -m pytest services/api/tests/test_research_journey_service.py -q --basetemp=.cache/<新综合测试目录>
```

窗口复核分别使用全新的绝对 report-dir，复用本页已维护的 `--research-smoke`、`--notebooks-smoke`／`--notebooks-resume-smoke`、`--collaboration-smoke`／`--collaboration-resume-smoke`，以及文献管理、元数据、历史布局专项。只有配对的 resume 在同一目录重启，其余专项不得共用 profile。研究与文献管理专项需放置 `make-mvp-fixtures.py` 新生成的 fixture.pdf；笔记／协作专项自行生成资料。报告与截图保留本轮证据，1024／1280／1440 布局分别检查。

源码／冻结 HTTP 闭环、原生窗口与真实厂商检测分别记录。真实检测沿用 `--model-profiles-smoke` 的受控入口和明确的凭据授权；没有账号、额度或授权时记“本轮未实测”，不伪造通过。真实普通聊天与工具检测只能证明该端点／模型的小样本能力，不能据此断言研究质量或其他厂商均可用。用户后续全面测试、安装器、独立干净 Windows 与发布验收分开记录。

### 整改 R1 验证入口

R1 为后端统一读取合同、Storage 目录与目录依赖，不新增窗口烟测；跨阶段界面联动按 R3／R6 验收。涉及后端改动时先重建冻结后端，再运行完整回归：

```powershell
pnpm build:backend
services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/<新测试目录>
```

专项文件 `test_research_catalog.py` 共 24 项，覆盖：工具 schema、校验器与执行器同源及 `result_type` 注入；自编写“新生杯”目录四份文件；同名目录／文件按完整路径消歧；超过 50 项分页与 `has_more`／`last_page`；未解析、`partial`、`unsupported` 与 `failed` 的正文状态；空目录与专题范围为空；目录与专题为不同对象；专题会话的祖先路径、范围外父专题隐藏与范围隔离；文献／专题详情及隐藏关联／笔记过滤；专题材料阅读笔记；当前会话方案列表、实时 stale、采纳／撤回状态与目录依赖；指定材料、成员变化、改名和仅路径变化；搜索分页与超限页大小拒绝；以及脚本模型经研究循环列出四份文件并生成带目录依赖的预览。全部使用临时工作区和直接构造的自编写记录，不读取用户数据库。

R1 完成时的本地成绩为完整后端 **397 passed**、桌面 **93 passed**，类型检查、前端构建和冻结后端重建通过；这些成绩只对应 R1 实现，不代表 R2–R6 已解决。


### 整改 R2 验证入口

R2 追加迁移 030（schema 30），涉及后端改动时先重建冻结后端，再运行完整回归。专项：

```powershell
pnpm build:backend
services/api/.venv/Scripts/python.exe -m pytest services/api/tests/test_research_feedback.py services/api/tests/test_tool_protocol.py -q --basetemp=.cache/<新测试目录>
```

`test_research_feedback.py` 共 16 项，使用脚本模型覆盖：可修正参数错误→反馈→修正→方案预览；第三次可修正错误、重复无效调用、多工具混合成功／失败、终止错误不纠错；类型化 operations、旧字符串兼容和方案依赖纠错；工具生成方案后模型失败仍保留且可采纳；后续追问注入已采纳方案、全部采纳记录与正式对象；超长方案状态裁剪仍保留真实方案；长过程后最终回答保留；失败任务半截输出不进入历史；失败与完成时可见输出保留；迁移 030 的工具记录表可读。`test_tool_protocol.py` 验证协议损坏与业务错误的分离。完整后端为 **416 passed**（356.03 秒）、桌面 **93 passed**，类型检查、前端构建与冻结后端重建通过；未新增窗口烟测，R3／R6 再验收界面联动。


### 整改 R3 验证入口

R3 沿用 schema 30，无新增迁移。先运行 `pnpm typecheck`、`pnpm test`、`pnpm build`，涉及后端时重建冻结后端并运行完整 pytest。方案详情后端断言在 `test_collaboration.py`，覆盖操作路径、目标笔记／阅读笔记类型、历史决定、采纳记录导航、结构化冲突对象和追加来源偏移；前端标签恢复在 `workspace-tabs.test.ts`，紧凑卡片、推荐默认选择和选择联动在 `collaboration.test.tsx`，proposal 布局往返在 `layout.test.ts`。

窗口回归使用新的绝对 report-dir，目录预放自编写 `fixture.pdf`：

```powershell
apps/desktop/node_modules/.bin/electron.cmd apps/desktop/out/main/index.js --yorw-smoke --reader-smoke --collaboration-smoke --report-dir=<新目录>
apps/desktop/node_modules/.bin/electron.cmd apps/desktop/out/main/index.js --yorw-smoke --reader-smoke --collaboration-resume-smoke --report-dir=<同一目录>
```

`collaboration-smoke.json` 验证卡片摘要、详情标签选择与依赖、部分采纳、冲突撤回、方案标签和成果导航，并保存 1024／1280／1440 截图；`collaboration-resume.json` 验证任务、决定、方案标签与决定历史重启恢复且不自动续发任务。R3 未新增独立窗口脚本；旧 `collaboration-error.json` 若来自早期失败运行保留为证据，以最终同目录的 `collaboration-smoke.json`／`collaboration-resume.json` 和截图为准。完整成绩为后端 **421 passed**、桌面 **96 passed**，类型检查、构建和冻结后端重建通过。

### 迁移 031 与研究体验修复验收

031 增加会话分区（schema 31）。先执行 `pnpm build:backend`，再运行完整 pytest、`pnpm typecheck`、`pnpm test`、`pnpm build`。`test_research.py` 覆盖重命名／分区持久化、版本冲突和运行中改名不中断任务；`test_tool_protocol.py` 覆盖完整流破损参数可修正、截断流仍终止；`test_reply_navigation.py` 覆盖重复破损参数可重试、四篇文献笔记预览和卡片规则；前端 `research-session-list.test.tsx` 覆盖分区聚合与菜单入口。

窗口回归使用新的绝对 report-dir，研究与界面专项预放自编写 `fixture.pdf`：

```powershell
apps/desktop/node_modules/.bin/electron.cmd apps/desktop/out/main/index.js --yorw-smoke --reader-smoke --research-smoke --report-dir=<新目录>
apps/desktop/node_modules/.bin/electron.cmd apps/desktop/out/main/index.js --yorw-smoke --reader-smoke --notebooks-smoke --report-dir=<另一新目录>
apps/desktop/node_modules/.bin/electron.cmd apps/desktop/out/main/index.js --yorw-smoke --reader-smoke --ui-smoke --report-dir=<另一新目录>
```

`research-smoke.json` 额外验证会话重命名、新建分区和分组显示；`notebooks-smoke.json` 验证笔记页标题行、工具栏对齐、保存与多宽度截图；`ui-smoke.json` 验证研究页 1024／1280／1440 与 125%。分组与菜单断言使用真实 DOM 时序，不以静态渲染代替。

### R4 输入验收

`pnpm test` 包含 research-composer 静态渲染回归；原生交互另在 Garden 首页及会话输入中检查长中文／URL／多段粘贴、三行至八行增高、展开收起光标、Enter／Shift+Enter／中文输入法选词、忙碌及发送失败草稿保留。窗口覆盖 1024／1280／1440 与 125% 缩放；静态渲染通过不替代这些操作。

### R5 界面精简验收

`--yorw-smoke --reader-smoke --ui-smoke` 在新的绝对 `--report-dir` 运行，先用 make-mvp-fixtures.py 生成自编写夹具。ui-smoke.json 增加次级操作 Escape、唯一新会话、专题入口映射、零共享隐藏及文字树断言；研究页保存 1024／1280／1440 和 125% 截图，House 另检查 125%／150%。`--collaboration-smoke` 复核合并入口后的真实方案路径，使用本地 SSE 夹具，报告 externalRequests=0。首页现在为 textarea，测试驱动按元素类型选择原生 value setter；专题刷新先打开“更多操作”。

### R6 目录到成果闭环

新增 `test_rectification_journey_service.py` 在源码和冻结 HTTP 上串联两份 DOCX、两份 PDF 的目录浏览、分页、可纠正参数、类型化方案、部分／幂等采纳、当前回执追问、冲突撤回及重启。命令：

```powershell
services/api/.venv/Scripts/python.exe -m pytest services/api/tests/test_rectification_journey_service.py -q --basetemp=.cache/<新闭环目录>
```

完整验收先执行 `pnpm build:backend`，再运行完整后端测试、桌面测试、类型与前端构建。原生 `--ui-smoke`、`--collaboration-smoke`／`--collaboration-resume-smoke`、`--notebooks-smoke`／`--notebooks-resume-smoke`、`--research-smoke`、`--document-management-smoke`、`--history-layout-smoke`、`--metadata-review-smoke` 各用新隔离目录与自编写材料。

真实业务实测使用明确授权后的 `--model-profiles-smoke --live-business --live-config=<配置 JSON> --live-key-file=<密文文件>`，附带常规隔离参数；目录需含自编写 fixture.pdf 与 fixture.docx。主进程在隔离加密上下文中解密，renderer 不接收密钥；仅显式传入 live 参数才请求外部服务。live-research-business.json 记录目录到方案、部分采纳及后续追问，model-profiles-smoke.json 独立记录连接能力检测。结束后检查绝对路径仅位于隔离报告目录，清除凭据副本、该目录 secrets 与复制的 Local State；原配置、凭据不改动。业务实测不是全面质量评估，未触发的纠错不记为实测通过。

## v0.4.0 发布与文档对齐

发布状态唯一入口为 [PLAN](../PLAN.md)，发布文案为 [v0.4.0](releases/v0.4.0.md)。每轮候选使用新目录，不能混用旧版本后端或旧帮助文件。

1. 先对齐根和桌面 package.json、后端 pyproject.toml 与 uv.lock 的本项目版本；保持第三方锁定依赖，schema 仍为 31。
2. 按本页命令完成类型、桌面测试、冻结后端、完整后端测试及前端构建，再执行 electron-builder，将本版发布说明与使用指南装入 help。
3. 最终源码提交后重建制品。记录提交、工作树差异和锁文件 SHA256；确认工作树无业务源码差异。候选验证记录中的 base_commit 不是最终发布身份。
4. 对同批安装器和完整分发目录核对版本、后端和帮助文件，运行隔离窗口及配对重启；安装／卸载验证单列，受限 PATH 不能标作干净 Windows。
5. 用 `Get-FileHash -Algorithm SHA256` 为安装器生成标准 `SHA256SUMS.txt`。远端发布后核对标签提交、上传资产大小和哈希，再填写 PLAN 的发布回执并同步 README 与发布说明。需要时只追加文档回执提交，不移动已发布标签。

本轮候选位置、检查结果和未完成事项见 [发布准备记录](history/v0.4.0-release-preparation.md)。仓库整理不会自动执行提交、合并、标签或远端发布。


### 研究助理连接失败与长任务

连接模型失败时，任务保留输入、已有输出和已生成方案，不自动重试。先在 House 对当前研究模型执行聊天与工具能力检测，再选择“重新回答”；重试是新任务，旧方案仍须核对实时状态，不能因为回复失败就推断正式修改已发生。连接超时显示 TIMEOUT，其他连接中断显示网络提示。

工具返回可纠正的对象 ID 错误时，模型可在同次请求内重新查询真实对象；不要把执行中的单条工具错误当作最终任务结果。研究任务在既有 10 轮内预留最后两轮用于生成方案和说明，不继续无限浏览。信息不足时仅说明缺失，不编造正文或直接写入正式成果。

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

- `--tabs-smoke`：打开同一/不同文献和专题、展开和返回三个 Storage 工具、共享检索输入、标签去重、标题更新与键盘语义；同时覆盖 Garden 无侧栏首页、层级树打开、首页/正文默认父级、新建标签去重与草稿保留、新建/管理关闭保护、管理改名/移动与标签同步。
- `--tabs-resume-smoke`：恢复标签顺序、激活项、页码和侧栏模式。
- `--tabs-close-smoke`：未保存笔记的取消/保存关闭、关闭其他逐项确认与最终关闭；Garden 新建/管理标签的取消、放弃和创建关闭由 `--tabs-smoke` 覆盖。
- `--tabs-fault-smoke`：后端退出时保存失败保持标签打开。
- `--tabs-citation-smoke`：工具标签中的来源跳转到正确阅读标签和物理页；关闭阅读标签后可重新创建。
- `--tabs-chat-smoke`：长回答流式增长、自动跟随/回到最新、停止、重新回答、输入法组合输入和保存笔记。
- `--tabs-tool-resume-smoke`：工具标签重启恢复并返回阅读。
- `--tabs-resource-smoke`：阶段 B 文献资料/关系/专题材料；文献目录与本地搜索、整理文献独立标签及返回文献库；编辑标签和人工总结、关联专题、双向关联文献、笔记显示、从 Garden 首页和材料标签添加专题文献，并检查 1280×720/1440×900 的资料与材料视图无横向溢出。与 `--tabs-smoke` 一样，报告目录需有 `fixture.pdf` 和 `fixture2.pdf`。
- `--ai-workflow-smoke`：阶段 C 默认专题范围与显式全库切换、一次多选的批量导入矩阵、整理文献标签打开/保存/重开和既有 AI 追加/替换/回退；House 设置从首页进入检索/数据页；Garden 新建/管理/AI 标签流程按当前界面执行；空范围、范围变化及 HTTP 错误由后端 pytest 覆盖。报告目录需有 `fixture.pdf` 与 `fixtures/` 下的 5 份文字和 3 份负例。
- `--layout-smoke`：1280×720、1440×900 的聊天/Garden/工具视图、目录收起和 1024 窄覆盖侧栏；Garden 另覆盖 1024×768、层级树/路径列表、搜索祖先、展开/收起全部、长名称和当前项高亮。阅读布局循环另覆盖 1440×1024 与 1024×768。高 DPI 可在同一次运行传入 `--force-device-scale-factor=1.25`。

这些烟测输出 `desktop-smoke.json`、`layouts.json`、`layout-panels.json` 和截图；`--ai-workflow-smoke` 另输出 `ai-workflow-smoke.json`、`ai-state.json`、`ai-restart.json`，并覆盖 AI 优化的材料范围选择、一次多选批量导入、整理文献标签保存/重开和打包流程。夹具模型只证明界面、协议和持久化行为，不代表真实论文质量。

阶段一多格式验证：

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

CLAUDE.md 导入 AGENTS.md 作为统一开发约束，不重复维护架构和命令。历史版本名 v0.2.1 仅用于说明原计划与旧验证现场，当前统一发布版本为 v0.2.0。

## 候选制品与发布流程

历史 v0.2.0 发布候选为 schema 15；阶段一已合并 main（ed65e79 / schema 19），当前 main 已合并阶段二（PR #19 / 639509b），schema 20，应用版本仍为 0.2.0。包内帮助仍固定为当前使用指南与 v0.2.0 发布说明；更新帮助后必须重新打包，不能上传旧 review 包。

1. 完成功能与文档 review，保留已验证源码树与依赖锁指纹。
2. 按上文重建前后端，运行类型、桌面与冻结后端回归；选择新的输出目录构建 NSIS 安装器和完整分发目录。
3. 使用新生成的自编写 PDF 对候选目录运行完整流程与恢复；核对包内帮助、后端、版本和 schema，记录安装器、可执行文件及分发目录各文件的 SHA256。
4. 合并后，确认目标提交与候选源码树一致；若源码、锁文件或包内帮助变化，重建并重新验证。标签应指向最终合并提交，不能仅凭同版本文件名选择资产。
5. 用户决定发布后上传对应安装器与 SHA256SUMS.txt；核对 GitHub Release 的标签、目标提交、资产和线上校验清单。公开发布及线上核验尚未完成时保持 pending。

阶段一最新候选及 review 结论见[v0.3.0 阶段一记录](history/v0.3.0-phase1.md)；v0.2.0 的旧候选来源另见[历史发布准备](history/v0.2.0-release-preparation.md)。不要按相同应用版本号混选制品。


### 阶段一整改验收

`--rectification-smoke`（兼容旧 `--builtin-reading-smoke` 名称）需同时使用 `--yorw-smoke --reader-smoke --report-dir=<绝对目录> --preview-soffice="<用户安装的 soffice.exe>"`。目录内准备自编写 `fixture.pdf/docx/doc/md/txt`。脚本在隔离工作区操作 House 设置、转换预览与原件阅读，输出 `rectification-smoke.json`、`word-preview.png` 和 `house-home.png`。原生文件选择与确认由测试桩提供；授权边界另由 main 单元测试验证，不能声称已自动操作真实原生对话框。

源码回归使用新临时目录，冻结服务回归前重建后端。测试 schema 断言随追加迁移更新；不修改历史迁移。已合并 main 基线 schema 20，当前整改分支追加至 schema 22，应用版本仍为 0.2.0。


`--builtin-reading-smoke` 使用 `--yorw-smoke --reader-smoke --report-dir=<新绝对目录>`，不传解析组件路径、不设置解析器配置。目录准备自编写 fixture.pdf/docx/md/txt。它验证内置 DOCX 表格/只读展示、缺失可选组件提示、关键词检索依据与原件标记、问答依据；问答使用进程内自有 loopback 模型协议夹具，不代表真实模型质量。输出 builtin-reading-smoke.json 与 builtin-reading.png。可选 LibreOffice 的 --rectification-smoke 另行执行，Word 需主动点击可选版式预览。


## 阶段二复现与验收

阶段一已通过 PR #18 合并 ed65e79。阶段二从干净 main 创建 feature/document-enrichment-rag，追加 020，锁文件不变。源码和冻结后端分别测试；不要把模型夹具当成真实论文质量。

```powershell
# 每个输出文件用新名称；报告以独占写保护。
services/api/.venv/Scripts/python.exe scripts/evaluate-retrieval.py --mode baseline --report .cache/<新基线>.json
services/api/.venv/Scripts/python.exe scripts/evaluate-retrieval.py --mode keywords --report .cache/<新关键词>.json
services/api/.venv/Scripts/python.exe scripts/evaluate-retrieval.py --mode metadata --report .cache/<新元数据>.json
```

固定语料 services/api/tests/fixtures/retrieval_phase2.json 是 CC0 自编写数据，20 份文档 / 65 问题，PDF/DOCX/MD/TXT 均经过真实内置解析。报告含语料 SHA256、全部失败、正例 Recall@5/MRR@5、元数据子集、范围和证据违规、无答案误召回、延迟及调用量。metadata 模式使用固定人工标注的元数据，不使用真实模型，因此不能证明生成质量或语义模型效果；embedding/chat 关闭，模型调用为 0。评估不写入用户工作区，临时库位于 .cache 并在结束后清理。

构建命令沿用上文。若当前进程策略阻止脚本，可仅对构建进程使用 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-backend.ps1`，不修改系统策略。打包采用新的 `release/<本轮候选>` 完整目录，不覆盖阶段一唯一验证制品。

阶段二窗口烟测：`Yorw.exe --yorw-smoke --reader-smoke --enrichment-smoke --report-dir=<新绝对目录>`。目录先准备 make-mvp-fixtures 生成的 fixture.pdf；程序使用隔离 profile 与自有 loopback 模型夹具，实际操作 House 授权开关、导入、AI 资料、确认专题、原文依据，并验证元数据搜索输出原文；生成 enrichment-smoke.json/enrichment.png。旧无外部组件阅读烟测仍通过 --builtin-reading-smoke 单独执行。

阶段二代码、冻结后端、窗口及评估证据集中在[阶段二记录](history/v0.3.0-phase2.md)。阶段二已 review 并合并；后续改动按 PLAN 验收，不自动提交/推送/合并/发布。独立干净 Windows、真实模型质量、NSIS 与签名继续分别验收。

DOCX 整理/布局回归：先用 `scripts/make-mvp-fixtures.py .cache/<新目录> --enrichment-docx` 生成自编写中文活动决算文件，再运行上述 --enrichment-smoke 命令并增加 --enrichment-docx-smoke。报告同时断言空值/文字列表响应只调用一次模型即可处理，资料页只有一个滚动区，AI 卡片随整页滚动，1280×720/1024×768 无横向溢出，并保存资料页截图。


## 文献目录回归

迁移 021 增加逻辑文件夹。后端 test_folders.py 覆盖循环、名称/版本冲突、非空删除、批量原子性、原件保留以及源码/冻结 HTTP 路径；前端 library-folders.test.ts 覆盖子目录筛选与异常循环收敛。

打包窗口验收：make-mvp-fixtures.py 生成新隔离目录，然后运行 `Yorw.exe --yorw-smoke --reader-smoke --folders-smoke --report-dir=<绝对目录>`。结果为 folders-smoke.json 与 library-folders.png，验证目录展开、子目录筛选、受限路径和原件哈希/解析版本不变。协议与本地窗口成功不代表独立干净 Windows 验收；系统默认应用与 Explorer 行为需在目标机器复核。

目录 review 后 folders-smoke 同时核验根目录直属归属、上级导航、菜单边缘限制、唯一导入以及鼠标/键盘调整宽度；保存 library-folders-1024.png、library-folders-1280.png 和 library-context-menu.png。


## 阶段三 UI 验收

在新隔离目录用 make-mvp-fixtures.py 生成夹具，执行 `Yorw.exe --yorw-smoke --reader-smoke --ui-smoke --report-dir=<绝对目录>`。新增 ui-smoke.json 验证无标签时隐藏标签栏、设置去重、未改预设关闭、修改后关闭保护、跨标签草稿及密钥不进布局；截图包含 House 1024/1280、125%/150% Chromium 缩放、解析设置和 Storage。缩放不等同于独立 Windows DPI 验收。

资料/专题窗口回归使用 --tabs-resource-smoke，需把生成的 SyntheticStudyB.pdf 另复制为同一隔离目录下的 fixture2.pdf。报告保存资料关系、来源、标签与布局结果；后端、前端、类型及构建门禁沿用上文。窗口截图与报告仅保留在 .cache，程序包在 release，不入 Git。


## AI 记录与元数据 review 回归（schema 22）

先重建冻结后端，再运行完整后端、前端、类型检查和构建。迁移 022 的 test_enrichment.py 回归覆盖逐条隐藏/恢复、旧隐藏状态迁移、输入元数据、按字段采纳、并发冲突、原文过期、跨文献隔离和失败事务回滚。

用 make-mvp-fixtures.py 生成新的隔离目录，运行 `Yorw.exe --yorw-smoke --reader-smoke --metadata-review-smoke --report-dir=<新绝对目录>`。自有 loopback 模型生成两条记录，窗口实际切换历史、隐藏/恢复、追加去重标签与总结、确认替换标题，检查两个页面职责、目录单击展开/双击进入和管理状态。结果 metadata-review-smoke.json；确认框由脚本桩确认，不代表人工原生对话框验收。

--tabs-resource-smoke 已适配新职责：总结与标签在元数据表单验证，关系在其下方管理，笔记仍在资料页。--enrichment-smoke/--enrichment-docx-smoke 的推荐专题确认也迁到元数据页；先前历史报告中的旧 UI 位置不适用于当前版本。本轮候选与报告路径集中于 history/v0.3.0-workspace.md，避免另建测试指导文档。

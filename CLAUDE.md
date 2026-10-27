# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目入口与硬约束

Yorw（知栖）是 Windows 本地优先的科研阅读与知识工作区。产品模块固定命名为 **Storage / Garden / House**。

开始改动前先读 `AGENTS.md`、`README.md`、`PLAN.md`；涉及当前界面重构时读 `PLAN_v0_2_1.md`（阶段 A 步骤 1–6 已在 `feature/user-interface-optimization` 实现并等待用户 review；步骤 7–12 另行启动）。数据、通信与 AI 合同见 `docs/architecture.md`，环境与验证口径见 `docs/development.md`，阶段 A 证据见 `docs/history/v0.2.1-stage-a.md`。

必须保持的不变量：

- SQLite 是正文、来源与修订的权威存储；Markdown 只是导出格式。已应用的 SQL 迁移只追加，不改写。
- renderer 不接触密钥或任意系统权限；main 只暴露固定、校验来源的 IPC。聊天/embedding 密钥由 main 用 `safeStorage` 读取，经私有请求头交给本地后端，不进入任务 JSON、renderer 或日志。
- Wiki 只能人工采纳；保存校验 `base_revision_id`，替换/回退创建新修订，AI 不静默覆盖正文。
- 沿用现有技术栈与锁文件（`pnpm-lock.yaml`、`services/api/uv.lock`），不顺手升级依赖或引入新的状态框架。
- 提交、合并、打标签和发布分别处理，均需用户明确授权；功能实现完成不等于获准提交或发布。

## 常用命令

仓库根目录（PowerShell），环境为 Node 24、pnpm 11.25.0、Python 3.12、uv：

```powershell
$env:UV_CACHE_DIR = "$PWD/.cache/uv"
pnpm install --frozen-lockfile
uv sync --project services/api --locked
pnpm dev
```

验证与构建：

```powershell
pnpm typecheck
pnpm test
pnpm build:backend
services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/<新测试目录>
pnpm build
pnpm package:dir      # 完整分发目录
pnpm package:win      # NSIS 安装器
```

单个测试：

```powershell
pnpm --filter @yorw/desktop exec vitest run tests/chat.test.ts
services/api/.venv/Scripts/python.exe -m pytest services/api/tests/test_chat.py -q --basetemp=.cache/<新测试目录>
```

完整桌面闭环（先构建冻结后端，再生成自编写样例；报告与样例目录必须尚不存在）：

```powershell
services/api/.venv/Scripts/python.exe scripts/make-mvp-fixtures.py .cache/<新样例目录>
powershell -NoProfile -File scripts/verify-mvp.ps1 -Executable release/<制品目录>/win-unpacked/Yorw.exe -ReportDirectory .cache/<新报告目录> -FixtureDirectory .cache/<新样例目录>
```

`pnpm build` 产物在 `apps/desktop/out/`，打包产物在 `release/`，一次性测试数据在 `.cache/`；这些都在忽略规则内，不得作为源码提交。

## 架构地图

通信链：**React renderer → 受限 preload IPC → Electron main → 本地 FastAPI → SQLite / PDF / 模型服务**。

- `apps/desktop/src/main/`
  - `backend.ts`：以 stdin 向 Python 传入 `{token, workspace_path}`；子进程监听 127.0.0.1 动态端口，HTTP 使用 Bearer 会话认证；`/v1/health` 通过后才 ready。stdin EOF 触发后端退出。
  - `index.ts`：窗口、`safeStorage` 密钥、Python 生命周期、每个 IPC handler 的来源窗口/mainFrame/URL 校验与错误码归一化。白名单错误码在 main 转成 `{ok,code}`，未知异常变成 `OPERATION_FAILED`。
  - `layout.ts`：校验并原子读写 `userData/workspace-layout.json`（版本 1、标签/激活项/侧栏/目录状态；不含正文、密钥、聊天输入或任务结果）。
  - 其余 `documents/notes/search/chat/garden/suggestions/workspace/intelligence/providers.ts` 是薄适配层：校验输入、补密钥或转发后端；业务真相在 Python。
- `apps/desktop/src/preload/index.ts` + `src/shared/status.ts`
  - 固定桥接操作与手写 TypeScript 合同（含 `layout:load/save`）。修改 IPC 时必须同步 preload、`shared/status.ts`、main 校验、Python DTO/路由和测试。
- `apps/desktop/src/renderer/`
  - React 19 + CSS，无路由、无 TanStack Query/Zustand/Tailwind。`src.tsx` 持有固定模块导航、统一工作标签、各模块最后活动标签和一次性引用跳转；`workspace-tabs.ts` 定义 `document/topic/notes/search/chat/ai/history` 标签，键为“类型:实体 ID”。
  - 任一时刻只挂载一个工具宿主：阅读侧栏或独立工具标签；两者共享 `session-state.ts` 的按文献页码/缩放/侧栏/检索/问答状态和按专题 AI 要求，以及 `Notebook`/`GardenBook` 的实体草稿。关闭标签的保存/放弃/取消与未保存标记由 App 统一处理。
  - `Notebook` 按 `documentId` 缓存会话级笔记草稿；`GardenBook` 保存专题目录、按 topic 的 Wiki 草稿、AI 审阅和历史状态；二者通过 `useSyncExternalStore` 订阅，未保存状态由关闭/退出保护读取。
  - Garden 有正文、AI 优化、修订历史三个专题标签；目录可收起，收起状态进入布局；AI 选材/截断恢复/来源检查和 revision 回退合同保持在原有后端路径。
  - AI 交互统一走 `ai-task.ts` 的 `useAiTask`：用 `request_id` 实现幂等，每 750ms 轮询 `/v1/ai/tasks` 最新任务；取消由用户显式触发；切换标签不自动取消或重发。问答使用上方滚动消息与下方固定输入，自动跟随/回到最新并处理 IME。
  - PDF 用 pdf.js，Markdown 编辑用 CodeMirror，预览禁止原始 HTML/图片/活动链接。
- `services/api/src/yorw_api/`
  - `__main__.py` 创建 FastAPI（无 docs/openapi）、Bearer 中间件和全部路由；workspace 打开失败通过 startup handshake 返回安全错误码。
  - `library.py` 管文献/页文本/chunks/metadata；`notes.py`、`garden.py`、`wiki_review.py`、`exports.py` 管对应业务；`providers.py` 存版本化地址与模型名（不存 key）。
  - `ai_workflows.py` 统一 `search`/`chat`/`draft`：持久化任务与阶段、request 幂等、取消/配置/来源版本检查；先持久化生成交接再派发模型调用。
  - `retrieval.py` 生成页内段落/句子切片，FTS5/BM25 与归一化 embedding 各召回、RRF 融合、去重后交聊天模型筛选；引用必须是原文切片，模型不能改写引文。
  - `chat.py`/`suggestions.py` 处理兼容 Chat Completions 的 SSE 流、输出预算（问答 4096、草稿 8192 token）和长度截断的一次续写。
- 数据层
  - `services/api/src/yorw_api/migrations/001–011.sql` 顺序迁移。`storage/database.py` 在打开时校验迁移序列、checksum、`user_version`、完整性和外键；升级前用 SQLite backup API 备份；单连接 + `RLock` + `BEGIN IMMEDIATE`，WAL 与 busy_timeout。
  - 权威记录：`documents/chunks`、`notes`、`conversations/messages`、`topics/revisions/suggestions/wiki_decisions`、`tasks`、`provider_configs`。`knowledge_*` 与旧 `search_*`/`embeddings` 是可重建的派生索引。
- 测试
  - `apps/desktop/tests/`：Vitest，默认 node 环境；React 组件用 `renderToStaticMarkup` 验证，主进程模块用 `vi.fn()` 模拟 `Backend`/`Providers`。标签/布局合同有纯函数测试。
  - `services/api/tests/`：pytest，使用临时工作区和 `--basetemp` 下的独立目录；`fixtures/retrieval.json` 是回归资产。
  - 原生 UI 烟测：`src/main/ai-workflow-smoke.ts` 和 `src/main/workspace-tabs-smoke.ts`，通过 `--tabs-*`/`--layout-smoke` 等隔离入口驱动真实 renderer、自编写 PDF 和本地 loopback 模型；只证明协议/界面/持久化，不代表真实模型质量。

## 当前产品与 AI 边界

- Storage 搜索/问答限当前文献；Garden 草稿自动从全工作区已保存文献、笔记和其他 Wiki 选材（最多 12 条 / 24000 字符）。语义检索默认开启，House 可全局关闭。
- 问答证据最多 8 条；近期最多 4 轮 / 6000 字符对话仅用于理解追问，答案重新查原文；无证据时本地拒答。
- 来源快照不可变；采纳追加时合并来源并重排 `S` 编号，替换与回退创建新修订。中断任务重启后不自动重发。
- 内容导出 ZIP 不是完整备份，不含 PDF、密钥、完整对话或全部修订。

## 历史教训（仍约束当前实现）

- 保存成功必须以服务端返回为准；界面状态不能替代业务保存，也不能把"请求已发出"或未保存文本标为已保存。
- 引用编号必须来自本轮实际提供的来源；存在引用不等于解释正确。来源失效状态动态计算，不写回不可变快照。
- 笔记、Wiki 正文和 AI 草稿的未保存编辑只在当前会话保留；没有崩溃恢复。离开页面、切换导航和关闭窗口都必须保护未保存内容。
- 冲突处理不能静默覆盖：笔记/正文比较版本或 `base_revision_id`，目录比较 `topic.version`；保存失败时保留草稿。
- 设计参考图只证明视觉方向。界面完成需实际检查截图、交互、焦点、键盘与窄窗口，构建成功不能替代布局验收。
- 每步交付要区分"已实现、已验证、待 review、已合并、已发布"；不得用文档整理或合并提交推定功能通过、发布或真实模型质量。

## 文档与工作方式

- 文档职责：README 导航，PLAN 当前状态与下一步，AGENTS 开发约束，product 产品原则，architecture 现役数据/通信合同，development 复现，history 只存当时的证据。功能改动要同步现役文档；不要把旧状态追加进现役说明。
- 新功能先明确范围、输入输出和验收，在用户授权范围内实施；遇到不明确需求先提问，不自行扩大范围。
- 测试使用临时目录与自编写夹具。模型夹具只证明协议、来源和持久化行为，不代表真实论文质量；受限 PATH 检查不等于独立干净 Windows 验收。不要编造测试、失败记录或真实模型准确率。
- 不提交真实论文、用户数据库、密钥、测试工作区、`.cache/`、`release/` 或唯一验证制品。

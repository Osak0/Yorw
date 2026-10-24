# 步骤 10：Garden 专题目录与人工编辑

2026-10-24 · feature/garden-editor · 起点 main 82cb6c1（已合并 PR #9）。**用户 review 通过**（2026-10-24）；已由用户提交为 9b42842，尚未发布合并；用户后续明确授权步骤 11 沿用 feature/garden-editor，见步骤 11 记录。

## 交付范围

Garden 保留正式名称、顶部导航和蓝色主题。页面内左侧为专题目录，右侧为 Markdown 正文；窄窗口目录位于正文上方。支持根专题/子专题创建、改名、调整父级、正文编辑与安全预览、Ctrl+S 或按钮保存修订，以及只读历史查看。没有专题删除、AI 生成/采纳或历史回退入口；后两项依 Steps 11–12 实现。

专题名去除首尾空白后为 1–120 字，允许同名，由 UUID 区分。目录在保存事务内沿父级链检查，拒绝自身/后代及不存在的父级；前端父级选项也排除自身和后代。标题/父级表单需点击“保存目录信息”，它与正文保存分开；目录草表单不承诺跨专题切换保留。

首次创建同一事务建立专题与空白初始修订 1。正文上限 200,000 字，每次变更保存生成新修订；相同内容无新修订，改名/移动不创建正文修订。旧修订不可改写；手工正文保留上一修订的来源快照，不自动把人工观点标为论文事实。

正文草稿按专题在本次会话中保留，切换专题/Storage/House 不丢失；关闭/重新加载时保护未保存或正在保存内容。无草稿崩溃恢复。失败保留正文，Ctrl+S 与连续点击不会重复发起同一保存；保存期间新输入不会被旧响应标成已保存。状态不确定可重试，紧接上次相同内容和同一基线的重发不会重复创建修订。

并发正文保存比较 base_revision_id，冲突时阻止盲目覆盖，允许比较最新修订后显式保留草稿、采用最新基线再保存，或确认放弃草稿并载入最新。目录编辑比较 topic.version，失败保留表单；刷新后用“载入当前目录信息”取最新目录版本。历史是只读快照，查看不会覆盖草稿；需再次点击“查看修订历史”刷新列表。

## 数据与通信

007_garden.sql 将 schema 6→7，新增 topics/revisions：parent_id 自引用、current_revision_id 指向当前正文；revision 记录 ordinal、body_md、sources_json、origin、base_revision_id、restored_from_id 和时间。修订编号在专题内唯一，数据库触发器拒绝修订 UPDATE/DELETE。current_revision 必须属于当前专题，由服务层校验。创建、保存和指针更新均在同一事务，失败回滚。

受控桥接 garden.list/get/create/update/save/history 对应 /v1/topics 与其 revisions 固定路由，main 校验 UUID、长度和版本；不暴露任意 SQL/HTTP，不读取模型凭据。复用受限 Markdown 预览，不加载原始 HTML、图片或外链。

Garden Wiki 正文使用独立 revisions，不为了设计占位而扩展 notes.topic_id；既有文献笔记和引用规则保持。专题附属笔记不在本步功能范围。AI 建议来源与回退将在后续步骤基于当前修订接口实现。

## 验证证据

- TypeScript 检查及 Vitest 18 项通过，包括保存响应晚于新输入、失败/冲突草稿保护、重复提交抑制、切换与目录刷新保留正文、main 路由校验及既有桌面回归。
- pytest **65 项完整回归通过**（含新增升级测试）；覆盖目录循环/失效父级、元数据版本冲突、跨专题基线拒绝、不可变修订、重复保存、失败事务回滚、来源快照保留、源码/冻结服务的 HTTP 重启读取。
- 专门以 schema 6 创建已有文献/笔记/聊天，再升级到 7，验证正文保持、外键完整，Garden 初始化为空。首次夹具漏填文献 extraction_status 已修正，未放松应用约束。
- 原生开发版隔离烟测通过创建/编辑、修订历史、导航草稿、关闭保护和第二写入者冲突；1440/1024 宽度控件未溢出，已核查截图。本机打包版再验子专题、改名、移动及上述正文流程，隔离打包版已通过，报告记录 nestedCreation / renameAndMove / draftAcrossNavigation / closeProtected / conflictProtected 均为 true，历史共有 5 个正文修订。

本步功能不调用聊天或 embedding 服务；自动化验收使用隔离工作区，不接触用户真实资料；隔离报告与截图位于 .cache/step10-desktop/ 和 .cache/step10-packaged/，不进入 Git。最终分发程序位于 release/step10-review/win-unpacked/Yorw.exe；本机分发不代表干净 Windows/签名安装器已通过，后者仍属 Step 14。

## 复现与回归清单

1. 退出旧程序，打开最新 review 程序（或 pnpm dev）。确认原有文献、问答和笔记可用，进入 Garden。
2. 创建根专题和至少两个子专题；在目录切换，展开“专题名称与父级”，分别重命名和移到根目录/其他专题。自身及后代不能作为父级，根/子层级显示应正确。
3. 输入含标题、列表、表格与中文的正文，预览核对；Ctrl+S 或“保存修订”后检查成功状态。切换专题和导航再返回，已保存内容应一致。
4. 编辑但不保存，切换专题/导航后应保留草稿；尝试关闭应用应有继续编辑提示。注意不以本次草稿代替崩溃恢复。
5. 多次保存变更，查看修订历史，选择旧版只读查看；当前正文不应被覆盖，空初始修订仍可查看。改名/移动不增加正文修订。
6. 保存、退出重启，检查目录和正文持久化；再打开历史确认可读取。断开本地服务等失败不得显示保存成功，草稿应保留；并发冲突可由自动化夹具复现，本步无回退操作。
7. 后续回归记录目录层级、正文/预览、历史、草稿与重启结果；本步不测试 AI 草稿或模型效果。

复现：pnpm typecheck；pnpm test；pnpm build:backend；services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/step10-tests。

打包：pnpm build，然后 pnpm --filter @yorw/desktop exec electron-builder --win --x64 --dir --config.directories.output=../../release/step10-review。原生烟测使用自有双页 fixture.pdf 所在绝对隔离目录：pnpm --filter @yorw/desktop exec electron . --yorw-smoke --reader-smoke --garden-smoke --report-dir=<目录>。该模式自动选择继续编辑，不覆盖用户资料。


## Review 通过与仓库收口

2026-10-24 用户明确确认 Step 10 review 通过。本记录保留自动化测试与原生界面的具体证据，不补写用户未单独提供的逐项结果；AI 草稿、采纳和回退仍属 Steps 11–12。

本轮仅同步 PLAN、README、工程基线和本记录，清理可重新生成的临时 pytest 工作区、Python 缓存和 PyInstaller build；保留源码、迁移、必要测试、锁文件、依赖、冻结后端、release/step10-review 程序及 .cache/step10-desktop/、.cache/step10-packaged/ 阶段报告。文档修改只检查状态、相对链接与 diff，不重复运行无关功能测试。分支仍为 feature/garden-editor，提交合并由用户处理，未启动 Step 11。

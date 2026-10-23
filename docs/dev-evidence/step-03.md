# 步骤 3：本地工作区

2026-10-23 · feature/local-workspace · 2026-10-23 用户 review 通过，已提交并发布 [PR #3](https://github.com/Osak0/Yorw/pull/3)，合并状态以 PR 为准。起点 main `2b3e5ce` 已合并步骤 2；本步不进入模型设置或文献导入，后续用户明确授权发布与合并，记录见 PR。

## 实现与设计取舍

Electron main 将 `userData/workspace` 经启动配置交给 Python；renderer 不获得任意路径访问。开发目录仍为独立 Yorw-development，正式程序使用自己的 userData。工作区创建 documents、tmp、logs、backups 及 yorw.sqlite3，放在安装目录之外。

SQLite 仅创建 schema_migrations 和 workspace_meta（稳定 UUID 与创建时间），不提前创建未来业务表。连接启用外键、WAL、busy_timeout；服务内写入通过同一 RLock 与显式事务串行执行。健康检查返回真实 schema_version=1；受鉴权的 GET /v1/workspace 返回身份、创建时间与版本，不返回路径。

迁移使用有序 SQL 与 SHA-256 校验；拒绝较新数据库、历史缺失和已应用脚本变化。已有版本升级前使用 SQLite backup API 生成内部备份，备份失败停止；每步迁移在事务内写入结构、历史和 user_version，并验证完整性及外键，失败回滚。没有执行失败后自动覆盖/恢复用户数据库。SQL 作为 PyInstaller 数据资源打包。

受管理文件先独占创建 UUID 临时文件，完整写入和 fsync 后以不覆盖方式发布；只接受规范 UUID，路径不得跳出受管目录或跟随文件/子目录重定向。操作失败只清理本次创建的暂存文件；未知临时文件和已有文件在重启时保留，避免推测删除。当前这是存储原语，不是 PDF 导入 API，也不判断 PDF 合法性。后续步骤 5 负责摘要去重、业务事务及孤立导入对账。

## 验证与已知边界

- pytest **11 项通过**，覆盖重启后的身份/数据/文件读取、重复启动、写入回滚、升级前备份、迁移失败回滚、较新版本拒绝、脚本变化拒绝、备份失败阻止升级、并发写入、外键约束、非法路径、复制中断、目标/暂存碰撞不覆盖。
- 开发解释器与 PyInstaller 后端验证鉴权、schema_version=1、工作区信息接口、EOF 退出；所有测试数据位于临时目录，真实论文不作夹具。
- TypeScript 检查、Vitest 2 项回归通过；桌面构建与含 SQL 资源的独立分发目录生成通过。开发与生产桌面均 ready，隔离检查通过。
- 首次 PyInstaller 相对 SQL 源路径被当作相对 spec 目录，修正为绝对源路径后重建；旧分发目录 app.asar 持续被占用，两次重试失败且未发现运行中的 Yorw，改用独立 release/step3 目录验证，不删除旧产物或强杀用户程序。
- 沙箱临时目录/脚本权限限制使用正常权限执行验证，未修改系统执行策略。

本步独立分发目录命令（先 `pnpm build` 和 `pnpm build:backend`）：`pnpm --filter @yorw/desktop exec electron-builder --win --x64 --dir --config.directories.output=../../release/step3`。默认 release/desktop 的文件占用来源未确认，不能声称该目录重建问题已解决。

## 用户 review 入口

运行 `pnpm dev`，确认服务连接；关闭并重开后，工作区 SQLite 的 workspace_meta 身份不变，schema_migrations 只有版本 1。本步使用上文独立分发目录命令构建，启动 `release/step3/win-unpacked/Yorw.exe` 可检查独立正式工作区。不要使用旧的步骤 2 NSIS 安装包判断步骤 3 行为。

复现：`services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/step3-tests`。打包测试前执行 `pnpm build:backend`；`pnpm typecheck`、`pnpm test` 验证桌面回归。

未提供用户工作区迁移/更改位置界面、完整备份恢复、持久笔记或 PDF 导入；这些属于后续步骤。干净 Windows 与安装器验收仍属于步骤 14。

## Review 后收口

用户已明确通过步骤 3 review。PLAN 同步为通过；用户随后授权发布与合并，代码提交为 `28547ee`，交付见 PR #3；步骤 4 未启动。清理本步临时测试库、截图、烟测报告、Python 缓存及 PyInstaller 构建中间目录，保留锁文件、迁移 SQL、有效测试和最新可运行分发目录。未删除真实 userData 工作区、内部迁移备份或旧的被占用分发文件。

本轮收口仅整理文档和生成残留，未修改功能源码；核查本地文档链接、Markdown 表格和 Git diff 空白，不重复运行此前已通过的功能测试。

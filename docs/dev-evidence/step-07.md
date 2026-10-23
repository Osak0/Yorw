# 步骤 7：Storage 文献笔记

2026-10-23 · `feature/document-notes` · 实现与验证完成，待用户 review。起点 main `d57df53` 已包含步骤 6（PR #6）。本步未提交、发布或合并，不进入检索、问答与 Wiki 开发。

## 实现与边界

Storage 阅读器增加“笔记”入口；每篇文献可以新建多条人工笔记，按首行识别内容，切换编辑与预览。CodeMirror 6 提供 Markdown 编辑、撤销及编辑器内 Ctrl+S；保存按钮与反馈区显示正在保存、未保存、失败或冲突，不将发出请求视为保存成功。

宽窗口使用右侧并排面板，支持指针拖动分隔线及方向键/Home/End 调整到 320–480px；1100px 及以下使用原生 modal dialog 覆盖面板，限制焦点在面板内，Escape/关闭后返回“笔记”入口。未提前展示未实现的聊天标签。保留 Storage / Garden / House 顶部导航。

采用 `react-markdown` + `remark-gfm` 预览标题、列表、代码块与表格。不引入原始 HTML 渲染插件，图片仅显示替代文字，链接显示为文字，不加载远程图片或开放页面跳转。手工笔记只关联所属文献，默认 sources 为空，不自动成为已验证论文证据；来源生成与跳页属于步骤 9。

Python 增加 `004_notes.sql`，SQLite schema 从 3 升至 4；沿用升级前内部备份、校验和检查与事务迁移。`notes` 保存稳定 ID、文献外键、Markdown、来源快照、版本和时间；不保存第二套文件正文。新增 GET/POST `/v1/notes` 与 PATCH `/v1/notes/{id}`；main/preload 只暴露按文献查询与明确保存操作，不暴露路径、任意 HTTP、后端端口或令牌。

新建笔记在会话内生成稳定 UUID，重试创建不会重复插入，也不覆盖已有后续编辑。更新在事务中比较 version，冲突返回 NOTE_CONFLICT；用户可读取已保存版本、比较后保留自己的草稿再次保存，或确认放弃草稿。手工修改保留已有 sources 快照，不接受客户端伪造引用。单条保存上限为 20 万字符（桌面按 UTF-16 长度计数，emoji 等字符可能占两位）。

草稿按文献与笔记 ID 存于独立于界面生命周期的会话状态；返回列表、切换文献/导航、关闭面板与本地服务失败不会清空已载入草稿。保存捕获提交时的内容，等待期间新输入的文字仍标记未保存。存在未保存内容或进行中保存时，关闭/重载需确认；选择继续编辑不会提前停止 Python。移除文献前要求先保存或放弃该文献草稿。文献删除后已保存笔记留在 SQLite，关联状态为不可用；本步没有历史笔记归档界面。

## 验证结果

- TypeScript 与 main/preload/renderer 生产构建通过。
- Vitest **10 项通过**，包含提交等待期间继续输入、重复保存、网络失败、冲突比较与明确处理、不同文献/笔记的草稿隔离、加载失败防空白覆盖、安全 Markdown 预览与受限 IPC 输入；保留此前密钥与后端启停测试。
- pytest **32 项通过**，包含 schema 3→4 升级/备份、笔记版本冲突、写失败回滚、来源快照保留、两篇文献笔记隔离、删除后历史保留；真实 HTTP 在开发与冻结后端中保存中文笔记并重启进程读取。补充文献隔离断言后，相关 2 项再次通过。
- 真实 Electron 在隔离库验证：双页 PDF 阅读 → 新建并保存中文 Markdown → 预览 → 修改草稿 → 返回文献库与切换导航 → 草稿仍在 → 关闭请求被阻止且后端保持 ready → 注入真实版本冲突 → 比较并保存。测试选择“继续编辑”自动处理关闭确认，不使用用户资料。
- 本机生产分发程序通过同样流程；1440×1024 并排面板与 1024×768 modal 面板均在窗口内，Escape 关闭后恢复入口焦点。安全存储探针通过，renderer 无 Node 权限。最终分发程序连续两次完整启动均以 0 退出，第二次 restoredFromPreviousProcess=true；报告位于 `.cache/step7-packaged/desktop-smoke.json`，这些临时结果不进入 Git。

自动化曾因连续点击未等待 React 更新而停在冲突处理；又发现对尚未可见的 CodeMirror 编辑区立即聚焦会触发本机 renderer 原生崩溃。烟测现等待编辑区实际可见后聚焦，最终运行通过；不把失败记录算作功能通过。关闭保护按 [Electron 官方说明](https://www.electronjs.org/docs/latest/api/browser-window#event-close) 显式设置 beforeunload 返回值，并通过真实窗口关闭验证。测试诊断失败时也保证回收后端。

依赖为 CodeMirror 6（codemirror 6.0.2、state 6.7.6、view 6.43.15、lang-markdown 6.5.2）、react-markdown 10.1.0 与 remark-gfm 4.0.1，安装前核对 MIT 许可与 React peer 兼容性，版本写入 pnpm 锁文件。浏览器代码随 renderer 打包，作为构建依赖安装；未增加 Python 依赖。预览依据 [react-markdown 官方说明](https://github.com/remarkjs/react-markdown)，并以本地测试核查实际输出。pnpm 仍报告既有打包工具链的 4 个传递依赖弃用提示；本步不升级无关工具链。

## Review 入口

运行 `pnpm dev`，或打开 `release/step7-review/win-unpacked/Yorw.exe`。

1. 在 Storage 打开自己的 PDF，点击“笔记”，新建两条笔记，输入中文、标题、列表和表格，切换编辑/预览并保存。
2. 修改未保存内容，关闭面板、返回列表、打开另一篇文献，再回到原文献，核对不同文献/笔记草稿没有串写。
3. 保存后完整退出、重启，核对正文；再制造未保存修改并尝试退出，选择继续编辑，核对草稿与保存仍可用。
4. 在宽窗口拖动分隔线，并聚焦分隔线用方向键调整；缩窄窗口检查覆盖面板、Tab、Escape 和关闭后焦点。
5. 保存失败不应清空草稿或伪报成功；不要用真实笔记测试强制崩溃，未保存内容尚无崩溃恢复。

复现命令：`pnpm typecheck`、`pnpm test`、`pnpm build:backend`、`services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/step7-tests`。桌面构建后运行 `pnpm --filter @yorw/desktop exec electron . --yorw-smoke --reader-smoke --notes-smoke --report-dir=<绝对测试目录>`，目录内需要自有双页 `fixture.pdf`；烟测工作区位于该目录的 `workspace/`，再次使用同一目录可验证进程重启恢复。

独立分发：`pnpm build`、`pnpm build:backend`，再运行 `pnpm --filter @yorw/desktop exec electron-builder --win --x64 --dir --config.directories.output=../../release/step7-review`。

## 已知限制

草稿仅在当前进程会话中保留，不承诺强制结束、系统断电或 renderer 崩溃后的恢复；重要内容应及时保存。本步不含自动保存、笔记修订历史、删除已保存笔记、附件、公式排版、原文精确引用或导出；来源接入、Wiki 与内容导出按后续步骤实施。保存后重启可恢复正文，不保证光标、撤销栈、预览模式与面板宽度跨重启恢复。

分发程序未签名，干净 Windows 与安装器验收仍归步骤 14。embedding 真实服务验收仍待步骤 8 前落实。本步测试仅使用生成的虚构 PDF 与笔记，不读取或修改用户真实工作区、论文与模型密钥。

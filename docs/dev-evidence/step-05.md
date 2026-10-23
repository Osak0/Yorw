# 步骤 5：Storage 导入与列表

2026-10-23 · feature/pdf-library · 2026-10-23 用户明确确认 review 通过，已随 PR #5 合并到 main（0d7e2ba）。起点 main `b3060b0` 已包含步骤 4 合并。本步交付时未进入步骤 6；后续步骤状态以 PLAN 为准。

## 本步交付

Storage 提供原生对话框单文件导入、SHA-256 去重、列表、任务状态/进度、元数据编辑、停止/重新抽取及移除。renderer 不传文件路径；main 校验文件大小并通过 multipart 上传实际选中文件，Python 保存受管副本。聊天与 embedding 均不参与导入，不调用云端模型。

新增 003_library 迁移，按本步创建 documents、chunks、tasks，不提前实现笔记/Wiki/检索。chunks 保留原始物理页码、抽取版本和 UUID；目前按有文字的页面保存，步骤 8 再实现检索分块和索引。标题、作者可从 PDF 元数据读取，标记来源；年份未知时为空，人工保存单独标记来源并检查 version，冲突不覆盖草稿。

导入使用持久化的 UUID/摘要凭据辅助跨文件与数据库对账，副本写入成功后记录文献和任务。失败或重启仅清理带有效凭据且摘要匹配的已知孤立副本；未知临时文件不被扫描删除。摘要重复时复用现有记录和任务；重复导入已移除或副本丢失的资料会重新保存，保留文献身份并递增抽取版本。

单工作线程按页抽取，不占用长数据库事务。空白/扫描 PDF 提示无文字且无 OCR；加密 PDF 不尝试解密；损坏文件保留失败记录供用户检查/重试。部分抽取保留已有页码与文字并提示限制。停止与删除使任务取消，完成前再次检查文献与任务状态，防止晚到结果重新写入。重启将遗留任务标记 interrupted，不自动重新执行；用户重试产生新任务。

移除采用 tombstone，事务内删除 chunks、停用活动任务及索引代次指针，保留历史对象身份；提交后移除受管文件。文件被占用时显示清理待重试，关闭重开执行已知 tombstone 文件清理。未来笔记/Wiki 的来源失效根据 tombstone 与抽取版本判断；当前没有创建 FTS/向量索引或历史笔记，不声称这些未来模块已实现。

## 验证

- Python **28 项通过**：既有工作区/模型回归，以及有效英文文字、空白、加密、损坏、部分页面 PDF，重复导入、文件上限、元数据冲突、重启读取、删除竞态、取消、重试、摘要凭据对账和数据库提交失败清理。
- 开发与 PyInstaller 后端均通过真实 HTTP multipart 导入 → 抽取状态查询 → 去重 → 人工编辑 → 删除副本闭环。
- Vitest **4 项通过**，包含原生选择取消不上传、仅上传所选文件字节、不暴露路径的边界检查；原生对话框在单元测试中模拟，真实选择操作不计入自动化测试；用户随后已确认本步 review 通过，未额外报告逐项测试明细。
- TypeScript 检查与桌面构建通过。开发桌面服务 ready、renderer 无 Node 权限、Storage 空状态画面已检查。生产验证分发目录为 `release/step5-review`。
- 测试 PDF 为程序生成的自有夹具，含明确的虚构英文证据句，不是研究论文，不据此宣称复杂排版、中文或所有真实论文均可可靠解析。实际代表性论文集与问答验证在后续验收继续落实。

依赖为 pypdf 6.21.2（BSD-3-Clause）与 python-multipart 0.0.32（Apache-2.0），已锁入 uv.lock；未引入 PyMuPDF、OCR 或额外厂商 SDK。选型依据：[pypdf](https://pypdf.readthedocs.io/en/stable/modules/PdfReader.html)、[FastAPI 上传文档](https://fastapi.tiangolo.com/tutorial/request-files/)。

## 验收入口

运行 `pnpm dev`，或打开 `release/step5-review/win-unpacked/Yorw.exe`：

1. Storage 导入一份可抽取文字的 PDF，观察进度与页数；再次导入同一文件应去重。
2. 修改标题、逐行作者与年份，重启后核对记录与副本仍在。
3. 尝试加密、无文本或损坏 PDF，核对提示；失败/部分结果可重新抽取。
4. 确认移除，检查原始选中文件仍在，列表和当前 chunks 中不再有该文献。

复现：`pnpm typecheck`、`pnpm test`、`pnpm build:backend`、`services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/step5-tests`。分发目录构建：先执行 `pnpm build`，再运行 `pnpm --filter @yorw/desktop exec electron-builder --win --x64 --dir --config.directories.output=../../release/step5-review`。

## 限制

单文件上限 50 MiB、2000 页、单页文字保留最多 20 万字符、每文献最多 1000 万字符，截断/缺页记为 partial。后台 pypdf 解析不是可抢占沙箱；停止在分页边界或解析返回后生效，不承诺即时终止单页解析。关闭桌面沿用步骤 2 的后端回收，重启显示 interrupted。没有 OCR、密码输入/解密、PDF 阅读器、语义检索或真实问答。

生产包仍未签名，干净 Windows 与安装器验收仍属于步骤 14。本次不读取或导出用户真实论文、模型密钥及用量明细。

## Review 后收口

用户于 2026-10-23 确认步骤 5 review 通过。当时 PLAN 同步为通过、尚未提交与合并；后续已完成 PR #5 合并，步骤 6 另有交付记录。清理本步临时测试库、烟测截图和报告、Python 缓存及 PyInstaller 中间文件，保留源码、迁移 SQL、有效测试、锁文件、独立开发环境和 review 分发程序。真实 userData 工作区、论文副本、密钥及迁移备份不在清理范围内。

此次收口仅更新文档和清理生成残留，不修改已 review 的功能源码；复核 UTF-8、文档链接、Markdown 表格和 Git diff 空白，不重复运行此前通过的功能测试。

# 步骤 14：本机 MVP 验证与交付

2026-10-25 · feature/mvp-release-validation · 起点 main 3fb4860（PR #11，步骤 12–13 提交 5bd8533）。**步骤 14 用户 review 通过**（本机交付范围）；尚未提交、发布或合并，v0.1.0 release 由用户后续创建。**不将本机通过写成所有分发环境通过。**

用户已明确选择：“暂时没有，先交付本机验证版”。本机未发现 Windows Sandbox、VirtualBox 或 VMware；未创建或假设已有干净 Windows 环境。独立机器与真实代表性论文逐题质量评估继续列为待验证，不因此扩大 MVP 功能范围。

## 交付物与变化

- Windows x64 / 0.1.0：release/step14-review/Yorw-Setup-0.1.0-x64.exe，以及完整 win-unpacked/ 分发目录。包未签名，没有公开发布或自动更新。
- 安装包包含冻结后端和 resources/help/ 下的使用指南、已知限制、反馈模板；独立分发目录另附相同文档、自编写样例、artifact-manifest.json 和 SHA256SUMS.txt。
- README 收敛为面向用户的产品介绍、实际技术栈和文档入口；保留 Storage / Garden / House 的正式名称。新增[使用指南](../user-guide.md)、[限制说明](../known-limitations.md)、[反馈模板](../review-feedback.md)及[开发证据索引](README.md)。
- 新增自编写样例生成器、原生组合烟测和可复现验证脚本。smoke 模式的 Electron profile、密钥密文与工作区都隔离到新报告目录，普通启动继续使用原工作区。
- 修复慢 PDF 客户端可无限阻塞 HTTP 关闭的问题，增加 2 秒优雅关闭边界；Electron 保留独立 3 秒回收兜底。没有新增 schema、模型协议或业务能力。
- 安装配置改用 signExecutable=false，在不签名的同时保留资源版本编辑；最终 exe 属性为 0.1.0.0，避免把 Electron 45.0.0 当作 Yorw 版本。卸载配置保留应用数据，安装结束不自动打开真实用户工作区。

## 环境与自动化结果

本机 Node 24.14.0、pnpm 11.25.0、Python 3.12.10 核验通过；使用现有锁文件与依赖，无新增依赖。沙箱内虚拟环境解释器一度无法启动，沙箱外核验正常，没有改用其他 Python 或重新安装全局依赖。

| 检查 | 结果与证据边界 |
| --- | --- |
| pnpm typecheck / pnpm build | 通过；Electron main/preload、React 和 PDF.js 资源构建成功 |
| pnpm test | 25 项通过；含新增异常服务退出、正常关闭与安全启动错误测试 |
| pytest 完整回归 | 最终 94 项通过，67.45 秒；源码与重新冻结的后端均参与，没有冻结项跳过 |
| 关闭回归 | 停止读取 12 MiB PDF 响应的客户端，修改前超时失败；2 秒关闭边界后源码/冻结版测试通过 |
| NSIS 构建 | 成功生成未签名 x64 安装器；程序版本资源和随附帮助文件核对通过 |
| 本机安装 | 在无现有安装/快捷方式时，安装至仓库内隔离目录；安装程序退出码 0，安装后的 exe 哈希与分发 exe 一致 |
| 安装后组合流程 | .cache/step14-installed-proof/verification.json：passed，32.81 秒，版本 0.1.0.0；子进程 PATH 只保留 Windows 目录，无 Node/Python PATH 查找，清除 Python 环境覆盖变量 |
| 卸载 | 路径和卸载项精确匹配本轮测试安装后才执行；测试程序及其注册表项移除，目录外的隔离工作区与报告保留，未操作真实工作区 |
| 干净 Windows | **未执行**；受限 PATH 不等于独立干净机器 |
| 真实模型/论文质量 | 不新增准确率结论；已有 DeepSeek/embedding 接入 review 保留，深度体验需要用户在实际资料上核查 |

## 连续流程与恢复证据

组合烟测在自有临时工作区使用固定 PDF 和固定回复的 loopback SSE 协议夹具，不把夹具输出当成真实模型质量证据：

1. 导入与阅读，翻页/缩放、关闭阅读再打开，检查 Canvas/文字层及物理页保存。
2. 通过真实 renderer → preload → main → Python 路径准备证据、生成回答、点击引用跳页并转笔记；核查笔记保留同一条消息的原文引用。
3. 在 Garden 创建专题，选入该文献片段、刚转存的笔记及该次完成对话，预览三类材料后生成建议；核查材料对象 ID 与前一步一致。
4. 比较后采纳为第 2 修订，手工编辑保存第 3 修订，再通过历史比较回退为第 4 修订；正文及 document/note/message 三类来源恢复。
5. House 选择刚保存的笔记和 Wiki，创建 ZIP；独立解压核对 Wiki 等于保存正文，保留来源快照，模型请求正文不含测试 key。
6. 通过受控文件对话框导入另外 4 个文本样例和 3 个负例，再重复导入初始文件：最终 5 篇文本可用、3 篇分别标注加密/无文字/损坏，无重复条目。核对当前文献不召回另一篇的 survival 片段、缺 embedding 时明确降级关键词。
7. 在同一专题再启动一个生成任务，部分输出已保存后终止本轮拥有的后端进程。界面显示本地服务退出，会话内未保存正文仍可见；不声称它能在崩溃后恢复。
8. 重新打开安装后的程序，检查保存的 Wiki/笔记/问答/来源/阅读页码；中断任务标为 interrupted 并保留部分输出，不自动重发收费请求。原生界面截图已检查。

最终报告与截图：.cache/step14-installed-proof/ 下的 mvp-state.json、mvp-fault.json、mvp-restart.json、desktop-smoke.json、verification.json、installer-uninstall.json，以及 mvp-garden/house/storage/failure/resumed.png。导出样例在 .cache/step14-installed-proof-mvp-content.zip。所有测试资料和产物本地忽略，不进入 Git。

前一轮分发目录验证位于 .cache/step14-flow-final/；最终安装后报告才对应包含关闭修复和正确版本资源的最终安装包。首次烟测在重启等待中访问尚未渲染控件，已修正为等待元素；未放宽业务验收。

原完整回归曾两次出现父进程 EOF 后退出超时。诊断运行未稳定重现原时间序列；随后用停止读取 PDF 的客户端稳定复现无边界 HTTP 等待，并形成先失败、后通过的回归测试。未延长原 8 秒退出断言或删掉测试；最终完整 94 项通过。

## 样例与尚未验证项

scripts/make-mvp-fixtures.py 生成 5 份自编写英文文本 PDF，包含 18 页双栏样例，并生成加密、无文字、损坏三个负例。manifest 记录文件 SHA-256；固定 12 问模板来自既有检索样例，覆盖 4 个中文查英文、2 个英文关键词、2 个无答案、2 个跨文献干扰、2 个图像能力外问题。

本地假模型仅证明传输、状态和来源流转。没有把这些自编写 PDF 称为真实论文集，也没有自动完成真实服务的 12 问语义评估。用户接下来可用自己的 5–10 篇合法论文按[反馈模板](../review-feedback.md)核查，记录预期证据与物理页；无证据/图像问题不能只用“返回候选”判断回答正确。

独立干净 Windows、真实代表性论文的逐题抽取/跨语言/回答质量、其他厂商兼容性和签名发布均无本步通过结论。数据导出仍不是完整备份，草稿仍不具备崩溃恢复；详见[已知限制](../known-limitations.md)。

## 复现与用户 review

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm build:backend
services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/step14-tests-new
pnpm --filter @yorw/desktop exec electron-builder --win nsis --x64 --config.directories.output=../../release/step14-review
services/api/.venv/Scripts/python.exe scripts/make-mvp-fixtures.py .cache/mvp-samples-new
powershell -NoProfile -File scripts/verify-mvp.ps1 -Executable release/step14-review/win-unpacked/Yorw.exe -ReportDirectory D:/chuanzhicup/Yorw/.cache/mvp-proof-new -FixtureDirectory .cache/mvp-samples-new
```

路径按自己的仓库位置调整；样例/报告目录必须是新的。原生测试会在隔离配置中模拟服务退出，不能对真实用户工作区手动添加这些 smoke 参数。安装包操作是本轮受控本机实测，不由验证脚本自动卸载用户安装。

用户已于 2026-10-25 明确确认本步 review 通过。上述安装包或完整 win-unpacked/Yorw.exe 继续作为本轮验证制品；后续实际研究体验反馈按模板记录，另行确认改进范围。用户未单独反馈的逐项质量结果不补写为已验证；不自动进入新功能、提交、发布或合并。

## Review 后文档与仓库收尾

2026-10-25 同步 PLAN、README、工程基线及验证索引，标记本机范围的步骤 14 review 通过；新增 [v0.1.0 发布说明草稿](../releases/v0.1.0.md)。分支仍为 feature/mvp-release-validation；后续提交、发布分支、合并 main 和创建 release 由用户完成，当前不填入尚不存在的提交或发布结果。

清理 19 个可重新生成目录及 3 个临时文件，共 139,018,654 字节（约 132.6 MiB）：pytest/诊断/中间烟测工作区、已卸载测试安装的空目录、重复样例缓存、PyInstaller build、pytest/Python 缓存，以及失败烟测的重复 ZIP、builder-debug.yml 和当前无自动更新用途的 blockmap。部分测试目录需要在沙箱外清理，已重新核对全部绝对路径位于本仓库并排除重解析路径后执行。

保留最终安装器、完整 win-unpacked 目录、使用文档、样例及样例 ZIP、原始 artifact-manifest.json / SHA256SUMS.txt、冻结后端，以及 .cache/step14-flow-final/、.cache/step14-installed-proof/ 和对应导出 ZIP。原始构建指纹继续代表生成制品时的源码快照，不因本轮文档收尾而伪填为未来 release 提交。

本轮没有修改应用源码、测试或依赖，也没有重建已验收安装包；仅检查文档状态、相对链接、diff、保留证据和制品哈希。用户已有暂存区保持不变，本轮新增文档修改尚未重新暂存。干净 Windows、真实论文逐题质量评估等限制仍保留，不由整体 review 结论补写为已实测。

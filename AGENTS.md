# Yorw 开发入口

Yorw 是 Windows 本地优先的科研阅读与知识工作区。先读 README.md、PLAN.md；仅在改动涉及架构或历史时，再读对应 docs 文档。

- 前端：Electron/electron-vite、React/TypeScript、CSS；后端：Python 3.12/FastAPI/SQLite。沿用锁文件，不顺手升级依赖或更换技术栈。
- 启动与验证命令统一见 docs/development.md；数据、IPC、来源和迁移约定见 docs/architecture.md。
- 产品命名固定为 Storage / Garden / House。以用户知识工作为中心，常规 AI 操作减少步骤，内部技术细节不默认暴露到业务界面。
- SQLite 是正文、来源与修订的权威存储；Markdown 是导出格式。已应用 SQL 迁移只追加，不改写。修改 Wiki 需人工采纳、版本校验并可回退。
- renderer 不获取密钥或任意系统权限；main 只暴露受限 IPC。不得提交真实论文、用户数据库、密钥、测试工作区或打包产物。
- 测试使用临时目录和自编写夹具。模型夹具验证协议与工程行为，不代表真实论文质量；受限 PATH 验证不代表干净 Windows 验收。
- 新功能先明确范围、输入输出和验收；在用户授权范围内实施。提交、合并、打标签和发布分别处理，不能由文档整理推导发布授权。
- 功能改动同步当前文档；历史证据放 docs/history/，不把旧状态追加到现役说明中。README 负责导航，PLAN 只记录当前状态与下一步。
- 当前状态：统一准备发布 v0.2.0（包含原 v0.2.1 的阶段 A/B/C），schema 15。A/B 已经 PR #15/#16 合并 main；C 在 feature/ai-material-scope 已通过用户 review、已暂存，等待本次整理审查后提交合并。现役待办见 PLAN，历史见 docs/history/；真实模型质量、干净 Windows 与公开发布不能由本机验证推定通过。

默认只改当前仓库。上级目录的竞赛/会话记录不搬入产品仓库；不清除 Git 历史、用户数据或唯一验证制品。

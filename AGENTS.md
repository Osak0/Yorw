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
- 阶段一已由用户 review 通过并经 PR #18 合并到 main（ed65e79，schema 19）。阶段二已在 `feature/document-enrichment-rag` 实现并完成本地回归，等待用户 review（步骤 8–14），新增迁移 020（schema 20），应用版本仍为 0.2.0。不自动提交、推送、合并或发布。自动整理需明确授权、人工内容优先、专题关联需确认；元数据辅助检索默认关闭直至真实质量评估，夹具成绩不代表真实模型效果。范围与证据见 PLAN_v0_3_0.md、docs/history/v0.3.0-phase2.md。
- 后续文献解析、自动整理与检索通过统一接口及适配器实现。解析器只经 `yorw_api.parsing` 合同和注册表进入业务；Docling、LibreOffice、OCR 组件由用户自行安装，不在 Yorw 环境或安装包中静默安装；SQLite 继续作为业务权威存储。基础导入固定内置处理，DOCX 基础原件预览无需外部组件；第三方能力仅主动选择使用，缺失时说明所需组件，不阻断已支持的基础流程；旧 DOC 的转换依赖需明确提示。

默认只改当前仓库。上级目录的竞赛/会话记录不搬入产品仓库；不清除 Git 历史、用户数据或唯一验证制品。

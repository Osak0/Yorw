# Yorw 当前计划

更新：2026-10-28。详细下一版本计划见 [PLAN_v0_3_0.md](PLAN_v0_3_0.md)。阶段一已在 `feature/multi-format-import` 实现并等待 review；阶段二未开始。

## 当前实现

当前 main 发布基线为 v0.2.0、schema 15（`78648a3`）。开发分支 `feature/multi-format-import` 已完成 v0.3.0 阶段一步骤 1–7，schema 18；应用版本号仍为 0.2.0，尚未合并或重新发布。

阶段一现役闭环（分支）：PDF/DOCX/DOC/MD/TXT 导入 → 统一内容块与来源定位 → PDF 原文阅读或非 PDF 结构化阅读 → 搜索、问答、笔记、文献资料与专题关系 → Garden AI 草稿 → 人工采纳、修订与导出。Docling 与 LibreOffice 由用户安装，House 提供配置、能力检测与重解析；失败重解析保留上一可用版本。

实施与验证证据见 [v0.3.0 阶段一记录](docs/history/v0.3.0-phase1.md)。真实模型逐题质量、独立干净 Windows 验收和公开发布仍未完成。

## 开发准备状态

阶段一代码已提交在开发分支，后端 221 项测试、前端 55 项测试和类型检查通过；打包目录已完成基础多格式窗口烟测与冻结后端外部解析验证。当前没有已发现的仓库级开发阻碍。阶段一完成后等待 osako review，未获通过不进入阶段二。

## 下一步

| 阶段 | 范围 | 当前状态 |
| --- | --- | --- |
| v0.3.0 阶段一 | PDF/DOC/DOCX/MD/TXT、统一解析与来源、结构化阅读、外部 Docling 适配和可选 OCR | 代码完成，等待 osako review；真实 Docling/OCR 已用自编写样例验证。 |
| v0.3.0 阶段二 | 首次授权后的自动整理、AI 标签、已有专题推荐、元数据辅助 RAG、检索评估和替换接口 | 未开始；阶段一 review 通过后进入。 |
| 研究记忆 | 会话记忆、研究足迹和建议的初步设计 | 只形成构想，不开发长期记忆或自动建 Wiki。 |

本轮分支不安装第三方组件到 Yorw 环境、不迁移发布库、不更改应用版本、不合并或发布。Docling/RapidOCR/onnxruntime 与 LibreOffice 仅安装在用户环境；业务通过适配接口调用。

## 已知边界与后置范围

整理文献表单关闭前需保存；内容 ZIP 不是完整备份。具体使用与限制见[使用指南](docs/user-guide.md)。图像语义理解、思维导图、DOI/BibTeX、联网抓取、云同步、多用户、完整恢复、自主多 Agent 和本地模型部署继续后置。

## 历史与交接入口

[设计](docs/history/design.md) → [MVP](docs/history/v0.1.0.md) → [AI 改进](docs/history/v0.2.0.md) → [工作区 A/B/C](docs/history/v0.2.0-workspace.md) → [候选包](docs/history/v0.2.0-release-preparation.md) → [v0.3.0 阶段一](docs/history/v0.3.0-phase1.md)。历史保留当时状态，不作为当前指令；开发命令只维护在[开发指南](docs/development.md)。

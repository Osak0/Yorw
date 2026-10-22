# 知栖 Yorw

**Your own research workplace.**

知栖是面向个人研究者与科研学习者的本地优先阅读与知识工作区，希望将文献阅读、AI 讨论、笔记和专题 Wiki 连接起来，让研究中的认识持续积累，并能回到原文核查与修订。

> 项目目前处于产品设计阶段，尚未实现可运行的应用。以下体验与技术栈均为规划内容。

## 产品背景

论文、笔记和 AI 对话常常分散在不同工具中，围绕一个研究问题形成的理解难以复用。知栖希望让阅读、讨论和知识整理在同一工作区连贯进行，同时保留用户判断，区分论文事实、个人观点与模型推断。

## 产品概览

**Storage、Garden、House** 是知栖三个界面的正式名称，也表达我们对科研工作区的理解：积累材料、培育知识，并拥有属于自己的研究空间。

- **Storage**：积累研究材料与阅读过程。在这里管理和阅读 PDF、记录笔记，与 AI 进行带来源的讨论，并回到原文核查证据。
- **Garden**：让理解逐渐长成知识体系。从选定的论文、笔记与讨论培育专题 Wiki，确认 AI 修改，保留来源和修订记录。
- **House**：安放自己的研究工作区。首版用于模型连接、本地数据位置与内容导出；个人资料与研究主题将在后续逐步完善。

首版聚焦：**导入论文 → 阅读与问答 → 保存笔记 → 生成并确认 Wiki 草稿 → 重启后继续使用。**

数据默认本地保存，但不等于完全离线：使用云端聊天或 embedding 服务时，相关文本需要发送至用户配置的服务商；两类模型分别配置。

## 计划技术栈

| 模块 | 选型 |
| --- | --- |
| 桌面应用 | Electron + electron-vite，Windows x64 优先 |
| 前端与界面 | React + TypeScript、Tailwind CSS、shadcn/ui、Lucide |
| 状态管理 | TanStack Query + 少量 Zustand |
| 本地后端 | Python 3.12 + FastAPI + Pydantic + Uvicorn |
| 阅读与编辑 | PDF.js + pypdf、CodeMirror 6 + Markdown 预览 |
| 存储与检索 | SQLite + 本地文件、FTS5 + 多语言 embedding + NumPy |
| 模型接入 | 可替换的聊天与 embedding 接口，用户自行配置 API |
| 工程与发布 | pnpm、uv、Vitest、pytest、PyInstaller、electron-builder |

## 项目文档

- [产品设计](product_design.md)：产品理念与设计基线。
- [开发计划](PLAN.md)：当前首版范围、分步实施与 review 验收规则。

安装、使用说明与功能演示将在对应能力实现并验证后补充。

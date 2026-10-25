# 工程与验证记录索引

本文提供接手和复现入口；当前范围与 review/合并状态以 [PLAN](../../PLAN.md) 为准，历史记录不代表所有后续版本或机器均已通过。

## 当前交付

- [步骤 14：本机 MVP 验证与交付](step-14.md)：2026-10-25 用户 review 通过；安装包、连续流程、异常退出/重启、验收范围和未验证事项。
- [v0.1.0 发布说明草稿](../releases/v0.1.0.md)：由用户后续提交、合并和创建 release；当前不记录为已发布。
- [使用指南](../user-guide.md)、[已知限制](../known-limitations.md)、[深度体验反馈模板](../review-feedback.md)。
- [工程基线](../engineering-baseline.md)：目录、受限通信、数据与来源协议、迁移和实现差异。

## 分步记录

| 步骤 | 内容 |
| --- | --- |
| [00](step-00.md) / [01](step-01.md) | 产品执行范围、工程约定与视觉方向 |
| [02](step-02.md) / [03](step-03.md) | 桌面/后端生命周期、打包骨架与 SQLite 工作区 |
| [04](step-04.md) | House 独立模型配置、安全密钥与连接测试 |
| [05](step-05.md) / [06](step-06.md) / [07](step-07.md) | Storage 导入、阅读与 Markdown 笔记 |
| [08](step-08.md) / [09](step-09.md) | 文献内检索与带来源问答、引用转笔记 |
| [10](step-10.md) / [11](step-11.md) | Garden 目录/人工修订与选材生成独立草稿 |
| [12](step-12.md) / [13](step-13.md) | 建议比较确认、修订回退、House 数据位置与内容导出 |
| [14](step-14.md) | 组合流程、故障恢复与本机分发验证 |

## 复现入口

1. 按根 README 准备已锁定环境，运行 `pnpm typecheck`、`pnpm test`。
2. `pnpm build:backend` 后运行 `services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/<新目录>`；没有冻结程序时相关项明确跳过，不能等同完整回归通过。
3. `pnpm package:win` 构建通用安装包。步骤 14 使用单独的 release/step14-review 目录，具体命令见本步记录。
4. `scripts/make-mvp-fixtures.py` 创建自编写样例；`scripts/verify-mvp.ps1` 对打包或已安装的 Yorw.exe 运行组合流程和故障恢复。报告目录必须是新目录，避免覆盖旧证据。

自动化调用本地 SSE 夹具，测试 PDF 为自编写资料；这些结果只验证工程行为。服务商真实接入与用户 review 记录另列；跨语言召回、回答事实质量、代表性论文集和干净机器验收不由假模型或代码测试推定。

本地截图、测试工作区、模型测试密钥密文和打包产物均忽略，不作为默认公开提交材料。文档记录真实发生的失败、修复和复测，不重写或补造 Git/对话历史。

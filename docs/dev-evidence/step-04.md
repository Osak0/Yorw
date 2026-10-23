# 步骤 4：House 模型设置

2026-10-23 · feature/model-settings · 用户 review 通过；用户确认已接入 DeepSeek，并在服务商平台看到用量请求。本记录区分用户实测反馈与 Agent 本地测试，代码提交 `0dd0f62`，交付见 [PR #4](https://github.com/Osak0/Yorw/pull/4)，合并状态以 PR 为准。范围只含模型设置与连接测试，不开始文献导入或问答。

## 实现

- 聊天与 embedding 独立配置。用户选择优先接入 DeepSeek，预设 `https://api.deepseek.com` / `deepseek-flash`，模型名可改。按 [官方文档](https://api-docs.deepseek.com/) 核对，此 API 模型名对应 V4.1 Flash；GLM 不预设专有适配器。
- 新增 002_providers 迁移，SQLite 保存地址、模型、版本、时间和扩展选项占位，不保存密钥。旧工作区升级沿用步骤 3 的校验、备份和事务规则，旧迁移未改写。
- Electron main 使用异步 safeStorage 加密，密文写入 userData/secrets 下按种类与配置版本命名的文件；没有安全加密能力则拒绝保存密钥。新密文持久化后才提交配置；提交失败可能留下未激活的孤立密文，不在不确定提交状态下删除密钥。显式清除与保留原密钥分别处理，地址变更要求重新输入/清除密钥，避免误送至新服务。
- 保存和连接测试在 main 串行化；测试不会混用更新前后的地址与密钥。preload 只暴露 list/save/test；校验主窗口/frame/URL，renderer 不获得端口、令牌或密钥读回能力。密码输入提交即清空，不使用 localStorage。
- Python 接收测试请求的私有密钥请求头，仅在内存使用，不进入配置或响应。标准库 HTTPS 证书校验保持启用，拒绝 URL 中的认证/查询信息，不跟随重定向；HTTP 仅允许本地回环服务。
- 连接测试发送固定短文本到 chat/completions 或 embeddings；DeepSeek 测试关闭思考并限制输出 32 token。响应只返回成功/错误码或 embedding 维度，不回显模型输出。错误区分鉴权、余额、端点、限流、网络、超时与响应不兼容。

## 本地验证

TypeScript 检查、Vitest 3 项、pytest 16 项通过；覆盖聊天和 embedding HTTP 夹具、配置独立性/版本冲突、密钥密文写入/保留/清除/安全存储不可用、错误不回显上游敏感正文，以及原有迁移与文件测试。密钥单元测试使用模拟加密器，不作为 DPAPI 实测证据。

Electron 桌面烟测另执行实际异步 safeStorage 加密/解密往返，记录 secureStorage=true。House 画面已检查，两个表单均使用现有蓝色顶部导航与系统字体；未宣称已完成全面无障碍验收。

实际遇到旧工作区在 Codex MSIX 宿主内的路径虚拟化：数据库 resolve 路径拼写变化导致保护性拒绝。仅在 OS samefile 确认父目录为同一物理目录且文件名一致时接受等价路径，保留真正符号链接与越界保护；没有删除或重建工作区。异步 safeStorage 使用 Electron 45 本地类型定义中的 result 字段，不再调用已弃用的同步 API。

## 验收入口及剩余门槛

运行 `pnpm dev` → House → 本地输入 DeepSeek Key → 保存 → 测试；重启后确认模型配置和密钥状态保留，再测试。可用“清除已保存密钥”验证清除；更换地址会要求重新输入或清除密钥。不要在聊天中粘贴密钥。

2026-10-23 用户确认步骤 4 review 通过：已在本地接入 DeepSeek，服务商平台成功显示用量请求。这是用户提供的真实服务验收证据；Agent 没有读取密钥、查看账单或再次调用云端服务，不补写未报告的返回内容、费用或性能数据。步骤 4 的至少一组真实服务门槛按该反馈满足。embedding 的协议与本地模拟服务测试已通过，真实服务商/模型连通性仍待验证，步骤 8 开始前补齐；不能将 DeepSeek 聊天接入推断为 embedding 已验证。

复现：`pnpm typecheck`、`pnpm test`、`pnpm build:backend`、`services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/step4-tests`。本步分发目录使用 `release/step4-review` 独立输出，避免占用旧版分发目录。完整功能问答、流式生成、检索和 provider 扩展不属本步。

## 提交前收口

更新 PLAN 与 README，清理本步临时测试库、烟测报告/截图、Python 缓存、PyInstaller 中间文件及重复的旧 step4 分发目录。保留源码、迁移 SQL、有效测试、锁文件、最新 release/step4-review 分发目录及真实 userData 工作区/密钥文件。本轮只整理文档与生成残留，不修改功能源码；复核链接、表格和 diff，不重复消耗真实 API 额度。

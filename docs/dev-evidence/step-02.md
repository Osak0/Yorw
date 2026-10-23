# 步骤 2：环境与桌面骨架验收

2026-10-23 · `env_verify` · 2026-10-23 用户 review 通过；已随 env_verify 合并到 main（2b3e5ce）。

起点 `1c0f21b` 已包含设计合并。用户授权本分支实施步骤 2；本步保留真实源码、锁文件和自动测试，不进入步骤 3。

## 实现与复现

- Electron 管理 Python 子进程，经 stdin 传递随机会话令牌，后端只绑定 127.0.0.1 随机端口；通过健康检查后报告 ready。启动失败显示错误码，异常退出显示失败状态。
- renderer 开启 sandbox/contextIsolation、关闭 Node，只经受限 preload 获取状态；IPC 校验主窗口、主 frame 与页面 URL，拒绝外部导航、新窗口和权限请求。生产包不读取开发页面地址环境变量。
- stdin shutdown/EOF 控制后端退出，超时只终止本次子进程并等待退出；关闭发生在启动前时不再创建后端。
- Storage/Garden/House 为可切换的最小导航壳，显示真实服务状态。没有文献、数据库持久化、模型或 Wiki 业务。
- `pnpm package:win` / `pnpm package:dir` 自动进行类型检查、桌面构建、PyInstaller onedir 构建与 Electron 打包，避免使用旧源码产物。命令与环境复现入口见 [README](../../README.md)。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 工具链 | Node 24.14.0、pnpm 11.25.0、Python 3.12.10、uv 0.11.3；依赖由 pnpm-lock.yaml 与 uv.lock 锁定 |
| 环境 | uv 使用项目 .cache/uv 成功枚举并创建独立 .venv；SQLite/FTS5 内存检查通过 |
| 静态与构建 | TypeScript 检查、main/preload/renderer 生产构建、Python onedir、Windows x64 NSIS 生成通过 |
| pytest | 2 项通过：开发与打包后端均验证健康请求、缺失/错误令牌 401、EOF 正常退出；打包启动也执行 FTS5 探针 |
| Vitest | 2 项通过：缺失解释器显示失败；关闭先于启动时阻止创建子进程 |
| 桌面烟测 | 开发与生产包均 ready，renderer 无 process/require，仅暴露 getStatus，导航名称一致 |

桌面烟测可在构建后运行 `apps/desktop/node_modules/electron/dist/electron.exe apps/desktop --yorw-smoke --report-dir=<绝对临时目录>`；生产包替换为 `release/desktop/win-unpacked/Yorw.exe`。该模式启动隐藏窗口、保存状态和截图、关闭后端并退出，用于后续回归；不自动安装软件。日常运行使用 `pnpm dev` 或直接打开生产包。

## 环境问题与处理

沙箱网络报 WinError 10013，pnpm 项目注册软链接也可能因沙箱权限失败；正常权限下安装、测试与构建通过，不认定为普通终端开发阻塞。pnpm 构建脚本仅允许 electron/esbuild，明确禁用不使用的 electron-winstaller（本项目使用 NSIS）。首次 React 探针放在根目录导致子包依赖解析失败，移入桌面包后通过，临时探针已清理。

已移除未使用的 React 构建插件及 httpx 测试依赖，测试改用 Python 标准库 HTTP。清理临时探针、旧截图/报告和构建中间文件；保留开发依赖环境、最新分发产物和可回归测试。上述产物均被 Git 忽略，不作为源码提交。

## 已知限制与 review

- 未签名、默认 Electron 图标；不声明正式发布或 SmartScreen 信任已验证。
- 已验证本机分发程序启动，未执行 NSIS 安装/卸载或无预装 Node/Python 的干净 Windows 验收；后者归步骤 14。
- 当前只验证本步边界，不据此宣称 SQLite 持久化、PDF、问答或 Wiki 已完成。

用户 review：运行桌面查看三个入口与连接状态，关闭后确认后端回收；通过后按 PLAN 合并本分支，再启动步骤 3。

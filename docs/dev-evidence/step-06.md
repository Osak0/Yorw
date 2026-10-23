# 步骤 6：Storage PDF 阅读器

2026-10-23 · feature/pdf-reader · 实现与本地验证完成，用户 review 已通过。起点 main `0d7e2ba` 已合并步骤 5；后续已合并 main（d57df53，PR #6）；笔记由步骤 7 独立交付。

## 实现

文献列表增加打开阅读入口，进入后收起列表，保留顶部 Storage / Garden / House 与独立文献工具栏。提供上一页/下一页、物理页码跳转、50%–200% 固定缩放和适合宽度；PDF 使用原文件字体、canvas 渲染与可选择文字层。页面可横纵滚动；切换全局入口保留当前打开文献。

main 通过固定的 GET /v1/documents/{id}/file 获取 PDF 字节，preload 只接受文献 ID，不暴露绝对文件路径、后端地址或会话令牌。Python 拒绝已移除记录和缺失/越界文件。PDF.js 只接收字节；不挂载 PDF 脚本、表单与外链注释层。CSP 不启用 JavaScript unsafe-eval，仅为本地 WASM 允许 wasm-unsafe-eval。

PDF.js 6.4.299（Apache-2.0）已锁定为构建依赖；worker 打入 Vite 资产，CMap、标准字体、WASM、ICC 与 LICENSE 通过 prepare-pdf-assets.mjs 从已安装依赖复制到生成 public 目录，随 out/renderer 打包。源仓库不提交复制资源，不使用 CDN，也不将仅构建时使用的 PDF.js Node 原生 canvas 依赖放入生产应用。`pnpm dev` / `pnpm build` 自动准备资源。

阅读位置复用既有 last_page 字段，无新 schema；PATCH /v1/documents/{id}/position 在事务内校验正整数页码与数据库有效页数，不递增元数据 version。仅在页面渲染完成后按序提交当前物理页码，成功后才显示已保存。失败可重试；后端尚无页数时明确提示无法保存，而不是信任 renderer 任意提交页数。返回列表等候本次已发出的保存；新打开按当前记录恢复并限制在 PDF.js 实际页数内。

无文本、部分抽取或未就绪的文献仍可尝试阅读；显示 AI 只能使用已抽取片段的提示。损坏/缺副本显示失败和重试/返回入口；需要密码时不提供密码收集或解密，要求导入可读取副本。

## 验证

- Python **29 项通过**：新增文件字节接口、位置写入/读取、越界及类型拒绝、位置不改变元数据版本、删除后不可再读取/保存；开发与冻结后端均跑通 HTTP 文件读取与保存第 2 页。
- Vitest **5 项通过**：包括 IPC 只接收文献 ID、拒绝任意路径和非法页码，以及既有导入/密钥/退出回归。
- TypeScript 与 main/preload/renderer 构建通过。
- 真实 Electron 端到端使用自有双页 PDF，在隔离临时工作区导入 → 打开 → 翻到第 2 页 → 切换 150% 缩放 → 返回列表 → 重开恢复第 2 页；同时核查 canvas 非空像素及文字层仅出现一次原文。修正快速渲染切换中的旧文字层竞态，每次渲染使用独立文字层容器。
- 生产 review 分发目录同样通过上述渲染测试，服务 ready、renderer 无 Node 权限、安全存储测试保持正常。1440×1024、1024×768 目标窗口下工具栏均未溢出，截图检查阅读布局；Windows DPI 下实际 innerWidth 有约 1px 舍入差异。

固定 PDF 为程序生成的虚构英文句子，不是用户论文。前端烟测使用 --yorw-smoke --reader-smoke 与 report-dir 内 fixture.pdf，工作区也置于 report-dir/workspace，不修改真实论文库或密钥。测试流程可在 main 烟测入口复用；完整重启持久化另由 SQLite 与 HTTP 测试验证，不将返回列表重开冒充操作系统重启。

选型与 API 依据：[PDF.js 官方示例](https://mozilla.github.io/pdf.js/examples/)、安装包本地类型定义。安装时核对许可与 Electron 兼容性，不读取系统其他论文作测试。

## 验收与回归入口

运行 `pnpm dev`，或打开 `release/step6-review/win-unpacked/Yorw.exe`：

1. Storage 导入/选择自己的正常 PDF，点击打开阅读，测试翻页、物理页码跳转、文字选择和缩放。
2. 等待已保存提示，返回重开、关闭应用重启后核对页码；不同文献应各自保存。
3. 用无文本/部分抽取 PDF 检查可读性与 AI 限制提示；用加密或损坏文件核对失败反馈。
4. 缩窄窗口，检查工具栏换行、横纵滚动与返回入口可达。

复现：`pnpm typecheck`、`pnpm test`、`pnpm build:backend`、`services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/step6-tests`。`pnpm build` 自动复制阅读资源后，使用 electron-builder 的 `--config.directories.output=../../release/step6-review` 创建独立分发目录。

## 限制

只恢复物理页码，不保存缩放与页内偏移；不提供密码解密、OCR、批注、搜索、目录侧栏或精确坐标高亮。单页光栅预算上限约 1600 万像素、DPR 上限 2，视口任一方向超过 20000 CSS px 时拒绝渲染；过大页面可尝试更低缩放。真实复杂排版、CJK 与无障碍仍需更多样例检查，不用单个英文夹具宣称全面兼容。生产包未签名，干净 Windows 验收仍归步骤 14。

## Review 后收口

2026-10-23 用户确认步骤 6 review 通过。当时 PLAN 标记本步完成、分支待提交与合并；后续已合并 PR #6，步骤 7 另有交付记录。

清理本步隔离测试工作区、临时截图与报告、pytest/Python 缓存、PyInstaller 构建中间文件及可自动生成的 PDF.js 资源副本。保留实现源码、回归测试、锁文件、开发环境、构建输出与 `release/step6-review/` 验收程序；用户真实工作区、论文、密钥和迁移备份不在清理范围。

收口仅同步文档与清理生成物，未更改功能实现；检查 UTF-8、相对文档链接、Markdown 表格及 diff。上述功能测试沿用实现阶段的已通过记录，未因文档收口重复运行。

# 步骤 8：Storage 文献内检索

2026-10-23 · `feature/document-search` · **用户 review 通过**。起点 main `152f04e` 已包含步骤 7（PR #7）；本步尚未提交或合并，由用户后续处理。未开始步骤 9。

## 已确认的交付

- 阅读工具栏提供独立“笔记 / 检索”入口，直接打开对应侧栏；窄窗口使用覆盖面板，关闭/Escape 后焦点返回实际入口。
- 关键词检索使用本地 FTS5，英文按词、常见中文按重叠双字预处理。只检索当前文献已抽取文字；输入不作为 FTS 操作符执行。
- 语义索引独立使用 House 的 embedding 配置；智谱预设为 `https://open.bigmodel.cn/api/paas/v4`、`embedding-3`，不沿用聊天密钥。建索引前确认发送全部已抽取分块；启用语义查询提示发送本次查询，可能计费。
- **最终规则：关键词命中 OR 语义相似度达到阈值，满足任一条件即可展示；两者都不满足才无结果。** 两路候选按 RRF 合并排序、分块去重，最多各 40 条候选、默认展示前 8 条。阈值仅过滤语义候选；低于阈值但关键词命中的结果注明保留原因。
- 阈值允许输入 0–1 内小数（如 0.20、0.255），空值/越界值禁止查询，修改后点击“检索原文”生效。0 允许全部正余弦候选；初始 0.50 未经模型校准。设置仅为当前面板查询状态，不承诺跨关闭/重启保留。
- 结果保留精确原文、物理页、召回方式、文献/原片段/派生分块 ID、版本及余弦值；展示本次阈值与文献最高余弦值。片段和分数都不构成 AI 回答、相关概率或事实可信度。

## 数据与生命周期

`005_search.sql` 将 schema 4 升到 5。原有 chunks 保存按页原文及稳定 ID；派生 search_segments 每块最多 1000 个 Unicode 字符、重叠 150 字符，记录原片段、物理页、起止偏移和版本，返回 text 为原文精确子串。分块版本为 `chars1000-overlap150-cjk-bigram-v1`。

向量采用 NumPy 精确余弦检索，规范化为 little-endian float32；generation 绑定服务配置指纹/版本、抽取版本、分块版本及实际维度。单 worker、每批 16 块，完整成功后事务切换当前 generation；失败不覆盖仍有效的旧索引。配置变化、取消、删除或重新抽取后，在途结果不能成为当前索引，中断不自动重发请求。

本地关键词重建会明确清除该文献派生向量，再由用户选择是否重建语义索引，不修改 PDF 或笔记。单篇语义索引上限 5000 块、向量维度上限 4096、查询上限 1000 字符；批次边界取消，在途请求仍可能计费。缺配置、缺密钥、维度变化或服务失败时明确降级为关键词。

密钥只经 main 的私有请求头送往 Python，不返回 renderer、不进入数据库、任务或索引配置。发送确认绑定配置版本；更换配置后重新确认。拒绝重定向，校验响应数量、index、维度、有限性及非零向量，不展示上游原始错误体。智谱不附加其接口未列出的 encoding_format。

迁移校验新增 LF 标准化与精确 LF/CRLF 历史哈希兼容，`.gitattributes` 固定 SQL 为 LF；仍拒绝 SQL、注释和其他空白改动，不重写旧校验记录、不清空工作区。隔离测试已验证换行兼容；此前截图时刻的具体校验差异未直接复现，不声称所有迁移错误都能自动修复。

## 验证与用户验收

- 最近完整代码检查：类型检查通过，pytest **46 项**、Vitest **12 项**通过。覆盖四种关键词/语义命中组合、自定义 0.255、原文偏移、文献范围、索引持久化、版本失配、失败重建保留、取消/删除/重新抽取/配置变化竞态、异常向量与明确降级。
- 开发及冻结后端的真实 HTTP 检查通过，包括进程重启后的 generation/FTS 读取与删除清理。该服务使用本地向量协议夹具，不作为模型质量评估。
- 原生开发版及本机分发程序验证直接检索、空阈值禁止提交、0.255 可提交、关键词原文、缺配置降级及 Escape 焦点恢复；1440×1024 并排、1024×768 覆盖面板布局通过。笔记保存、草稿导航保留、冲突保护及关闭拦截回归通过；renderer 无 Node 权限，safeStorage 探针正常。
- Node 24.14.0、pnpm 11.25.0、Python 3.12.10；新增 NumPy 2.5.4，uv 锁定并在 PyInstaller 分发中包含其发行/许可证元数据。桌面和冻结后端构建成功。
- 用户截图确认智谱 embedding-3 **2048 维**索引完成；“胸部扫描”召回对应英文第 1 页（余弦 0.376）。research 的关键词命中约 0.362/0.346，按最终并集规则保留。用户于 2026-10-23 确认 Step 8 review 通过。Agent 未读取用户密钥或代跑真实云端测试。

完整后端检查曾两次出现开发进程 EOF 退出 8 秒超时（45 通过、1 失败），该项单独执行通过，随后无构建并行的完整重跑 46 项通过。未放宽时限或修改退出逻辑，原因尚未确认，后续复现时继续排查；最终通过不抹去该记录。

本轮用户批准后只整理文档及可再生成残留，不修改功能代码或重复调用真实 API。

## 复现与后续边界

当前程序：`release/step8-review/win-unpacked/Yorw.exe`；开发入口 `pnpm dev`。已有当前配置有效索引无需因调整阈值而重建。样例 A 的 research 在高阈值下仍保留关键词命中；原文无关键词且语义不达标的查询返回空；降低阈值可增加语义候选。

[固定 JSON](../../services/api/tests/fixtures/retrieval.json)包含两篇自写虚构材料及 12 个问题（跨语言 4、关键词 2、无依据 2、范围干扰 2、图像证据不足 2），[生成脚本](../../scripts/make-search-fixtures.py)可重建 PDF 与摘要 manifest：

```powershell
services/api/.venv/Scripts/python.exe scripts/make-search-fixtures.py .cache/step8-review-fixtures
```

脚本拒绝覆盖已有 PDF；现有样例保留在该目录，可选择新的空目录重建。自动测试的 toy embedding 只验证机制；用户总体 review 不等于逐题准确率或 5–10 篇代表性真实论文评估，这些仍需后续集成验收。降低阈值不等于改善模型理解能力。默认阈值校准、双栏顺序和代表性长文评估不预填成功。

复现检查：`pnpm typecheck`、`pnpm test`、`services/api/.venv/Scripts/python.exe -m pytest services/api/tests -q --basetemp=.cache/step8-tests`。冻结测试先执行 `pnpm build:backend`。分发构建：`pnpm build`、`pnpm build:backend`，再执行 `pnpm --filter @yorw/desktop exec electron-builder --win --x64 --dir --config.directories.output=../../release/step8-review`。

原生烟测：`pnpm --filter @yorw/desktop exec electron . --yorw-smoke --reader-smoke --search-smoke --report-dir=<绝对隔离目录>`，目录需有自有双页 fixture.pdf；不接触真实论文或 key。保留 `.cache/step8-desktop/`、`.cache/step8-packaged/` 的阶段报告与截图，它们不等同于最后一次真实服务模型评测。中间 pytest 工作区、Python 缓存和 PyInstaller build 可重新生成，已在收尾清理；依赖、冻结后端、当前 review 程序和样例保留。

本步不包含问答、引用跳页、精确高亮、全库检索、OCR、图像理解或 Wiki。干净 Windows 和已签名安装器验收属于步骤 14。步骤 9 需在本分支由用户提交合并后，另行授权并从最新 main 开始。

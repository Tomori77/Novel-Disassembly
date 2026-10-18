# 项目状态

更新：2026-10-18  
仓库：https://github.com/Tomori77/Novel-Disassembly

## 总览

- **核心拆解链路可用**：TXT / 导出的 ZIP / 文件夹导入 → 卷节切分 → 清洗 → 导出 TXT / ZIP / EPUB / 项目目录 → 回读。
- **持久化可用**：IndexedDB v2 书架、自动保存、刷新恢复、旧库迁移。
- **插件宿主可用**：v1 导出钩子、UI 侧栏视图、插件独立存储、事件、清单生成。
- **官方插件**：`ai-analysis` 0.2.1 已实现逐章分析、按卷归并、全书大纲与设定集、插件内 JSON/Markdown 导出，默认启用；`clean-annotations` 作为示例默认停用。
- **尚未实现**：搜索/统计插件、核心 Markdown/JSON/DOCX 导出、EPUB/DOCX/Markdown 导入、插件 `importers`/`exporters` 能力、AI 实体进入核心 JSON/词条体系。

## 功能矩阵

### 输入与拆解

| 功能 | 状态 | 说明 |
|---|---|---|
| 导入 TXT | 已实现 | UTF-8，必要时回退 GB18030 |
| 导入导出的 ZIP | 已实现 | manifest 精确还原；无 manifest 按目录推断 |
| 导入导出的文件夹 | 已实现 | `webkitdirectory`，与 ZIP 共用导入逻辑 |
| 卷 / 节两级切分 | 已实现 | 正则可配置；卷标题校验；重复卷合并 |
| 通知 / 请假 / 无更识别 | 已实现 | 独立成段识别，默认排除 |
| 重复章节 / 短章评分 | 已实现 | 分类结果可在清洗页复核 |
| EPUB / DOCX / Markdown 导入 | 未实现 | `import-formats` 插件设计完成 |

### 清洗

| 功能 | 状态 | 说明 |
|---|---|---|
| 水印、`ps`、章末附言清洗 | 已实现 | 导出副本清洗，不改原文 |
| 清洗页左右分栏预览 | 已实现 | 点击章节立即在右侧展示正文 |
| 鼠标拖拽多选 | 已实现 | 支持拖拽、Ctrl/Cmd 点选、Shift 范围选、全选 |
| 批量排除 / 恢复选中 | 已实现 | 逐条写入 IndexedDB |
| 排除全部疑似 / 恢复全部 / 重新检测 | 已实现 | 原有功能保留 |

### 输出

| 功能 | 状态 | 说明 |
|---|---|---|
| TXT 导出 | 已实现 | 卷标题 + 章节 + 分隔线 |
| ZIP 导出 | 已实现 | `<书名>/` 根目录、分卷、每章 txt、manifest |
| 项目目录 / 文件夹导出 | 已实现 | `export/<书名>/`；服务模式或目录授权 |
| EPUB 导出 | 已实现 | EPUB3，带卷目录 |
| Markdown / JSON / DOCX 导出 | 未实现 | `export-formats` 插件设计完成 |
| 导出模板与变量 | 已实现 | 卷目录 / 文件名 / 内容头；插件变量 |
| manifest 回读 | 已实现 | 新 `novel-disassembly/1`，兼容 `rp-disassembly/1` |

### 持久化与会话

| 功能 | 状态 | 说明 |
|---|---|---|
| IndexedDB 书架 | 已实现 | 书、原文、卷、章、设置 |
| 自动保存 / 刷新恢复 | 已实现 | 400ms 防抖、串行事务 |
| 旧库迁移 | 已实现 | `rp-disassembly` → `novel-disassembly`，旧库保留 |
| localStorage 迁移 | 已实现 | 规则/选项/模板/插件开关复制到新键 |
| 插件独立存储 | 已实现 | `pluginData`，按 `pluginId` 隔离 |
| 清理旧库 / 旧键 | 未实现 | 旧数据保留，后续可加清理入口 |

### 插件与扩展

| 功能 | 状态 | 说明 |
|---|---|---|
| v1 导出钩子 | 已实现 | `normalizeEntry` / `defineVariables` |
| 插件 UI 视图 | 已实现 | 侧栏导航 + 面板挂载 + `ctx` |
| 插件存储 | 已实现 | `pluginData` + `storage(pluginId)` |
| 插件事件 | 已实现 | `nd:book-changed` / `nd:chapter-changed` |
| 插件清单生成 | 已实现 | `tools/build-plugins.ps1` → `plugins/index.js` |
| `importers` / `exporters` 能力 | 未实现 | 设计已在文档中 |
| 官方 AI 插件 | 已实现（0.2.1） | OpenAI 兼容，逐章 → 卷归并 → 全书汇总，手动触发，按书持久化 |
| AI 类别勾选 | 已实现 | 大纲/人物/物品/地点/势力/事件/伏笔，默认全选，配置持久化 |
| AI 模型列表 | 已实现 | Base URL 自动补 `/v1`；`GET /models` 拉取模型候选 |
| AI 大纲 / 设定集 | 已实现 | 卷摘要、卷大纲、全书大纲、人物/物品/地点/势力/事件/伏笔合并去重 |
| AI 结果导出 | 已实现 | 插件内 JSON/Markdown，不含 API Key |
| AI 实体进入核心词条 | 未实现 | 当前仅存在插件存储，不进入核心 JSON/manifest |
| 搜索 / 统计插件 | 未实现 | 设计完成 |

### 工程与文档

| 功能 | 状态 | 说明 |
|---|---|---|
| 本地服务 `serve.py` | 已实现 | 仅 `127.0.0.1`，路径/Origin/Content-Type 校验 |
| `start.bat` 快捷启动 | 已实现 | Windows |
| 命名空间迁移 | 已实现 | `window.ND`；`window.RP` 永久别名 |
| 旧版单文件 | 已归档 | `legacy/Novel-Disassembly.html` |
| 工程文档 | 已实现 | `docs/`；插件 SDK `plugins/` |
| 自动化 golden 测试 | 部分 | 有手工/脚本对比，尚未固化为 `tests/golden` |

## 已知限制

- AI：逐章单次最多 50 章、单章最多发送 8000 字；卷归并约 12000 字、全书汇总约 16000 字输入上限；顺序执行，不支持并发、自动重试、断点续跑、费用上限；失败卷会跳过，全书结果可能不完整。
- AI 结果可导出插件内 JSON/Markdown，但尚未写入核心 JSON、`entity` 词条或 manifest；TXT/ZIP/EPUB 不输出 AI 内容。
- AI 的 Key 明文存本地 IndexedDB；归并质量依赖逐章摘要与实体质量。
- 浏览器直连部分模型服务可能被 CORS 拦截；可改用 Ollama 或支持 CORS 的兼容接口。
- 搜索/统计、核心 Markdown/JSON/DOCX 导出、EPUB/DOCX/Markdown 导入尚未实现（AI 结果可在插件内导出 JSON/Markdown）。
- 插件 `importers` / `exporters` 仍是设计阶段；当前只有 v1 钩子、UI 视图与存储。
- 旧 IndexedDB / localStorage 保留作回滚，不会自动清理。
- 24MB 级 TXT 整本读入内存；首次写入书架需要时间。
- ZIP 读取不支持 ZIP64/加密/分卷；`file://` 目录导出首次需授权。
- 插件刷新/停用会重建视图 DOM，没有 `unmount` 钩子；插件需自行清理监听。

## 下一步

1. `search-stats`：全文/正则搜索、卷统计、阅读时长。
2. `export-formats`：Markdown / JSON / DOCX。
3. `import-formats`：EPUB / DOCX / Markdown。
4. AI 实体接入核心 JSON/词条；补并发、重试、断点、费用上限与归并结果编辑。
5. 把 golden 对比固化为 `tests/golden`，覆盖核心导出与插件开关。

# 架构总览

## 1. 定位

- 纯前端、无构建、无第三方依赖；双击 `index.html` 或 `start.bat` 运行。
- 核心职责：把整本 TXT 拆成“卷 → 节”，产出统一词条；提供插件宿主与基础 I/O。
- 扩展职责：清洗、分类、导出格式、导入格式、搜索/统计、AI 分析以官方插件或第三方插件提供。

## 2. 运行时

| 方式 | 入口 | 能力 |
|---|---|---|
| `file://` | 双击 `index.html` | 全部前端功能；目录导出需首次授权项目根目录 |
| 本地 HTTP | `start.bat` → `python serve.py --open` | 同上，且导出可直接写入 `export/<书名>/`，无目录授权弹窗 |

两种方式共用同一套页面与脚本，仅 `js/export-target.js` 在启动时探测 `/api/health` 决定落盘通道。

全局命名空间为 `window.ND`（`js/util.js` 初始化）；`window.RP = window.ND` 是永久兼容别名，旧插件与旧脚本仍可沿用 `RP.*`。

## 3. 模块

```text
index.html
  ├─ js/util.js          文本规范化、中文数字、文件名、下载
  ├─ js/db.js            IndexedDB：书/卷/章/原文/设置
  ├─ js/zip.js           ZIP 写入（store）与读取（store/deflate）
  ├─ js/junk.js          无章节分类、重复检测
  ├─ js/parser.js        卷/节/通知识别、切分、导出正文清洗
  ├─ js/plugins.js       插件注册/加载/规范化/变量/模板
  ├─ js/importer.js      ZIP/文件夹回读、manifest 还原、目录推断
  ├─ js/exporter.js      导出计划、manifest、TXT/ZIP/EPUB
  ├─ js/export-target.js 服务端/picker 探测与写入
  └─ js/app.js           状态、视图、事件、自动保存
```

## 4. 数据流

```text
文件（TXT/ZIP/文件夹）
  → 解码（UTF-8 / GB18030 兜底）
  → parser.splitBook（卷/节/通知块，去重）
  → junk.classifyBook（排除/疑似/重复）
  → IndexedDB 保存（books/sources/volumes/chapters/settings）
  → 界面：素材 / 清洗 / 目录 / 阅读 / 导出 / 插件
  → 导出：
      plugins.normalize（词条规范化）
      plugins.variables（默认变量 + 插件变量）
      模板渲染（卷目录 / 文件名 / 内容头）
      exporter（TXT / ZIP / EPUB）
      export-target（下载 / 服务端 / 目录授权）
```

导出的 ZIP/目录包含 `_manifest.json`，回读时由 `importer` 精确还原；没有 manifest 时按目录结构推断。

## 5. 核心边界

**核心保留**

- 输入解码与换行/空白规范化
- 卷/节切分、通知块识别、编号与去重
- 词条模型、变量命名空间、模板语法
- 插件宿主：发现、加载、排序、错误隔离
- manifest 格式与回读
- 路径校验、目录写入、本地服务
- IndexedDB 书库与会话
- 目录/阅读/编辑/清洗/导出等壳层

**核心不实现**

- 新的导出格式（Markdown/JSON/DOCX 等）
- 新的导入格式（EPUB/DOCX/Markdown 等）
- AI 摘要与实体抽取
- 搜索/统计面板
- 第三方清洗规则

以上由官方插件或第三方插件实现，但默认能力（清洗、通知/重复识别、TXT/ZIP/EPUB 导出）保留在核心，确保零插件即可完成完整流程。

## 6. 持久化

- 数据库 `novel-disassembly` v1：`books`、`sources`、`volumes`、`chapters`、`settings`。
- 首次启动会从旧库 `rp-disassembly` 一次性复制五个仓库并校验条数，写入 `settings.legacyMigration`；旧库保留不删。新库已有书则跳过；迁移失败且新库为空时，本次会话降级使用旧库（`ND.db.isLegacy() === true`），下次启动重试。
- 复合主键 `[bookId, id]` 避免不同书的 `C00001` 冲突。
- 导入/切分后全量保存；改标题、排除、批量操作按章增量保存；会话设置防抖保存。
- 插件数据使用命名空间存储（v2 设计），避免污染核心表。

## 7. 插件宿主

- 清单：`plugins/index.js`（由 `tools/build-plugins.ps1` 生成），内容为 `window.ND_PLUGIN_INDEX` 数组；加载器同时接受旧的 `window.RP_PLUGIN_INDEX`。
- 加载：动态插入经典 `<script>`，按 priority 顺序执行，兼容 `file://`。
- v1 钩子：`normalizeEntry`、`defineVariables`；异常被捕获并记录，不中断导出。
- v2 计划：`importers`、`exporters`、`ui`、`provides`、实体词条，详见 [plugin-system.md](plugin-system.md)。

## 8. 安全边界

- 插件是本地 JavaScript，拥有页面权限；只启用可信代码，不联网安装。
- 本地服务只监听 `127.0.0.1`；`/api/export` 校验 Host、Origin、Content-Type 与每个路径段，拒绝 `..`、盘符、绝对路径。
- 写盘只发生在 `<项目>/export/` 或用户显式授权的目录内。
- 仓库不包含小说正文、密码、密钥或代理 token。

## 9. 已知约束

- 24MB 级 TXT 整本读入内存；首次写入 IndexedDB 需要时间。
- ZIP 读取不支持 ZIP64/加密/分卷；deflate 依赖 `DecompressionStream`。
- `file://` 目录导出依赖 `showDirectoryPicker`，首次需授权。
- 无 manifest 的目录回读只能推断结构，排除状态与类型无法恢复。

## 10. 相关文档

- [数据模型](data-model.md)
- [插件系统](plugin-system.md)
- [导出格式](export-formats.md) / [导入格式](import-formats.md)
- [插件化路线](../plugins/ARCHITECTURE.md)
- [开发与测试](development.md)

# 插件化架构设计

> 当前决策（2026-10）：清洗、通知/重复识别、TXT/ZIP/EPUB 导出**保留在核心**，保证零插件可用；AI 分析、搜索/统计、Markdown/JSON/DOCX 导出、EPUB/DOCX/Markdown 导入以**官方插件**提供，默认启用。本文的迁移路线作为长期参考，阶段 1/2 暂不执行。

本文回答两个问题：

1. 现有功能里哪些应该变成插件？
2. 本体应该保留什么，才能既“只做拆解”，又不牺牲默认体验？

结论先行：**本体保留“输入 → 切分 → 词条 → 插件宿主 → 基础 I/O”，把清洗、分类、导出格式、导入格式、分析与 UI 扩展逐步变成插件；导出/清洗等默认能力以“内置插件”形式随本体发布并默认启用**，而不是直接删掉。

---

## 1. 现状功能盘点

| 功能 | 当前实现 | 建议归属 | 理由 | 优先级 |
|---|---|---|---|---|
| TXT 读取、编码识别、换行规范化 | `app.js` `importFile` / `util.js` | 核心 | 输入是所有能力的前提 | — |
| 卷/节正则切分、卷标题合并、重复标题去重 | `parser.js` | 核心 | 这是“拆解”本身 | — |
| 通知/请假/无更段落识别 | `parser.js` `collectNotices` | 内置分类插件 | 规则会随书变化，应可替换/扩展 | 高 |
| 无用章节打分与排除 | `junk.js` | 内置分类插件 | 评分策略因书而异 | 高 |
| 重复章节检测 | `junk.js` | 分类插件 | 可独立开关 | 中 |
| 水印行、章末 `ps`/求票附言清洗 | `parser.js` `cleanExportBody` | 规范化插件 | 属于“导出前处理”，不是拆解 | 高 |
| 标题去标注（`（为…加更）`） | `plugins/clean-annotations` | 规范化插件（已实现） | 已是插件范例 | 已完成 |
| TXT / ZIP / EPUB 导出 | `exporter.js` | 导出插件 | 格式会持续增加（Markdown/JSON/DOCX…） | 高 |
| 导出路径与内容头模板 | `plugins.js` + `exporter.js` | 核心契约 | 模板与变量是插件共用的协议 | — |
| 导出到项目目录、本地服务 | `export-target.js` / `serve.py` | 核心 I/O | 涉及路径安全、权限、落盘，不宜交给插件 | — |
| ZIP 回读、manifest 还原 | `importer.js` | 核心格式 | 回读协议必须稳定，否则插件会各自为政 | — |
| IndexedDB 书架、自动保存、恢复 | `db.js` / `app.js` | 核心会话 | 跨插件的公共状态 | — |
| 目录、阅读、筛选、标题编辑 | `app.js` | 核心 UI | 壳层；搜索/统计可后续做 UI 插件 | — |
| 插件加载、启用、模板编辑 | `plugins.js` / `app.js` | 核心 | 宿主本身不能是插件 | — |
| EPUB / DOCX / Markdown 导入 | 暂无 | 导入插件 | 未来扩展 | 中 |
| AI 摘要、人物/事件抽取、全书分析 | 暂无 | 分析插件 | 依赖外部模型，必须可选 | 中 |
| 词频、阅读时长、卷统计 | 部分内置 | 变量插件 | 只读计算，适合插件扩展 | 中 |

判断标准：

- **决定“词条长什么样”的** → 核心（切分、字段、编号、回读格式）
- **只消费词条/改动词条副本的** → 插件（清洗、分类、导出、分析）
- **涉及磁盘、权限、路径、会话的** → 核心（导出目标、服务、IndexedDB）

---

## 2. 核心边界

核心只做六件事：

1. **输入**：读文件、识别编码、规范化文本
2. **拆解**：按卷/节切分，产出词条（book / volume / chapter / notice / note）
3. **契约**：词条模型、变量命名空间、模板渲染、manifest 格式
4. **宿主**：插件发现、加载、启停、顺序、错误隔离、能力目录
5. **I/O**：导出目标（服务端/目录授权）、路径安全、IndexedDB 会话
6. **壳**：目录、阅读、编辑、清洗结果展示、导出入口

核心不再新增具体格式或清洗规则。目标 API：

```js
RP.core.version            // 内核与词条 API 版本
RP.core.book()             // 当前书（只读视图）
RP.core.entries()          // 迭代词条（book / volume / chapter / notice）
RP.core.variables(entry)   // 生成该词条的变量表
RP.core.exportPlan(options)// 生成导出计划：词条、路径、模板、manifest
RP.core.register(capability)
```

`RP.core.exportPlan()` 是关键：导出插件只负责“把计划变成字节”，不再各自实现切分、命名和路径规则。

---

## 3. 词条模型 v2

v1 的 entry 只够导出用；v2 要把“拆解结果”表达完整：

```js
{
  kind: "book" | "volume" | "chapter" | "notice" | "note" | "entity",
  id: "C00001",
  parentId: "V001",

  book: {
    id, title, fileName, source, language,
    importedAt, stats: { chars, volumes, chapters, notices, notes, excluded }
  },
  volume: {
    id, number, title, name, synthetic, index,
    stats: { chapters, chars, excluded },
    firstChapterId, lastChapterId
  },
  chapter: {
    id, type, title, rawTitle, body,
    chars, paragraphs, readingMinutes,
    excluded, reasons, junkType, junkScore
  },
  index: { global, local, labelNumber, labelUnit },
  relations: { prevId, nextId, volumeId, childIds },
  flags: { edited, manual, reconstructed },
  meta: { }   // 插件写入，按插件 id 命名空间隔离
}
```

### 3.1 变量命名空间

保留 v1 的扁平变量（`{{title}}`、`{{chapterNo}}`），新增命名空间写法：

```
{{book.title}}        {{book.chars}}        {{book.chapterCount}}
{{volume.number}}     {{volume.name}}       {{volume.chars}}
{{chapter.title}}     {{chapter.chars}}     {{chapter.readingMinutes}}
{{index.global}}      {{index.local}}       {{index.labelNumber}}
{{stats.volumeChapters}} {{stats.firstChapterTitle}}
{{plugin.<id>.<var>}}
```

建议内核直接提供、插件可直接消费的派生变量：

- 路径类：`bookSafe`、`volumeNo`、`volumeSafe`、`chapterNo`、`localNo`、`titleSafe`
- 统计类：`chars`、`paragraphs`、`readingMinutes`、`volume.chars`、`book.chars`
- 关系类：`prevTitle`、`nextTitle`、`volumeTitle`、`volumeChapterCount`
- 时间类：`date`、`exportedAt`

### 3.2 “拆解出的词条”不止章节

后续可以把人物、地点、事件、伏笔也建成词条：

```js
{ kind: "entity", entityType: "character" | "place" | "item" | "event" | "foreshadow",
  name, aliases, firstSeenChapterId, mentions: [...], meta: {} }
```

这类词条由分析插件产出，核心只负责存储与展示；导出插件可自由消费（人物表、时间线、关系图）。

### 3.3 变量目录

插件在 manifest 中声明 `provides`：

```json
{ "provides": ["stats.readingMinutes", "plugin.character-list.characters"] }
```

核心汇总成“变量目录”，在插件页和模板编辑器里展示，避免用户猜变量名。

---

## 4. 插件能力（API v2）

v1 已有 `normalizeEntry` / `defineVariables`。v2 增加能力声明，按类型加载：

| 能力 | 作用 | 输入 → 输出 | 执行时机 |
|---|---|---|---|
| `importer` | 新输入格式 | File → entries | 导入时 |
| `segmenter` | 自定义切分规则 | text + rules → entries | 切分时 |
| `classifier` | 打标签/评分（通知、重复、短章） | entry → flags | 切分后 |
| `normalizer` | 改标题/正文副本 | entry → entry | 导出前、预览时 |
| `variables` | 注册变量 | entry → vars | 模板渲染前 |
| `exporter` | 新导出格式 | plan + entries → file/blob | 导出时 |
| `ui` | 面板/按钮/阅读增强 | slot + context | 界面加载时 |
| `lifecycle` | 书加载/切分/导出前后 | context | 事件触发 |

### 4.1 导出插件

```js
RP.plugins.register({
  id: "markdown-exporter",
  apiVersion: 2,
  provides: ["exporter.markdown"],
  exporters: [{
    id: "markdown",
    label: "Markdown",
    extension: "md",
    async build({ book, entries, variables, options }) {
      const text = entries.map((e) => `## ${e.chapter.title}\n\n${e.chapter.body}`).join("\n\n");
      return { fileName: book.title + ".md", blob: new Blob([text], { type: "text/markdown" }) };
    }
  }]
});
```

内核负责：选中哪些词条、排除规则、变量、路径模板、manifest；插件只负责序列化。

### 4.2 导入插件

```js
{ id: "epub", extensions: ["epub"], async parse(file, ctx) { return entries; } }
```

导入插件必须返回符合 v2 词条模型的 entries，核心负责落库、书架与后续切分/导出。

### 4.3 分类与规范化

```js
{ id: "notice-detector", classifiers: [{ id: "notice", run(entry, ctx) { return { type: "notice", score, reasons }; } }] }
{ id: "strip-ps", normalizers: [{ id: "strip-ps", run(entry, ctx) { entry.chapter.body = ...; return entry; } }] }
```

顺序由 manifest 的 `priority` 决定；内核保证异常隔离与逐条处理，不中断整本书。

---

## 5. 迁移路线

### 阶段 0：锁定基线（必做）

- 用《蛊》与 3 本不同排版的样本书生成 golden 输出（路径、文件名、内容、manifest 旧字段）
- 每次拆分前后跑对比，确保默认产物字节一致

### 阶段 1：清洗与分类插件化（低风险）

- 把 `cleanExportBody`（水印、ps、章末附言）抽成内置 `normalizer` 插件
- 把通知识别、重复检测、短章评分抽成内置 `classifier` 插件
- 默认启用，输出保持不变；插件页可逐项关闭
- 核心保留“应用分类结果/规范化结果”的调用点

### 阶段 2：导出格式插件化（收益最高）

- 把 TXT / ZIP / EPUB 改为内置 `exporter` 插件
- 核心新增 `RP.core.exportPlan()`，统一词条选择、编号、路径、manifest
- 旧按钮改为读取“已启用导出插件列表”，新增格式只需加插件
- 保持 ZIP 根目录、文件名、内容与 manifest 字段不变

### 阶段 3：词条与变量 v2（契约升级）

- 引入命名空间变量与派生统计（阅读时长、卷字数、首末章）
- 增加 `relations`、`meta`、`entity` 词条
- 保留 v1 扁平变量作为兼容别名
- 插件页展示变量目录与来源插件

### 阶段 4：导入与分析插件（生态扩展）

- EPUB / DOCX / Markdown 导入插件
- 搜索、统计、时间线等 UI 插件
- AI 摘要、人物/事件/伏笔抽取插件（产出 `entity` 词条）
- 插件配置、权限、版本锁定写入 manifest（可选）

每个阶段都遵守：**默认行为不变 → 内置插件默认启用 → 可关 → golden 测试通过**。

---

## 6. 不做成插件的东西

以下能力如果插件化，会带来安全或一致性问题：

- 插件加载器、排序与错误隔离
- 文本解码与规范化（输入一致性）
- 卷/节切分与编号规则（词条契约）
- 路径校验、目录写入、本地服务（安全边界）
- manifest 回读格式（长期兼容）
- IndexedDB 会话与书架（公共状态）
- 核心 UI 壳（目录/阅读/编辑）

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 插件顺序导致输出漂移 | manifest 固定 priority + 导出时记录插件 id/version 到 manifest |
| 24MB 书逐条克隆开销大 | 内核传只读视图 + 每章可变副本，避免整书深拷贝 |
| 插件改写核心状态 | `entry.meta` 按插件 id 命名空间隔离，核心字段只读 |
| API 版本碎片化 | `apiVersion: 2` 并存 v1；不兼容插件只提示不加载 |
| UI 插件破坏布局 | 固定 slot（侧栏、工具条、阅读器底部），不暴露任意 DOM |
| 安全 | 仅本地脚本、显式启用、无远程加载；导出/写盘仍由核心执行 |
| 性能 | 分类/规范化按章流式执行；导出插件拿到迭代器而非整书数组 |

---

## 8. 立刻可做的三件事

1. **抽 `cleanExportBody` 为内置 normalizer 插件**：改动小、可对比、直接验证插件管线
2. **新增 `RP.core.exportPlan()`**：为导出插件化打地基，先让 TXT/ZIP/EPUB 走同一计划
3. **补 golden 测试与 `provides` 变量目录**：后续每次拆分都有回归保护

完成这三步后，再把三个导出格式迁成插件，本体就只剩“拆解 + 宿主 + I/O + 壳”，同时默认体验不变。

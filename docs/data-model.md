# 数据模型

## 1. Book

```js
{
  id: "book-...",            // IndexedDB 主键
  fileName: "书名.txt",
  title: "书名",
  source: "txt" | "zip" | "folder",
  rawText: "……",            // 规范化后的全文（回读重建的书为拼接文本）
  volumes: [Volume],
  chapters: [Chapter],       // 按阅读顺序扁平列表
  stats: { chars, volumes, chapters, notices, notes },
  reconstructed: false,      // 是否由导出目录/manifest 还原
  missingFiles: 0,
  createdAt, updatedAt
}
```

## 2. Volume

```js
{
  id: "V001",
  index: 0,                  // 卷在书中的序号（从 0 开始）
  number: 1,                 // 解析出的卷号，可能为 null
  name: "魔性不改",           // 去掉“第X卷/：”后的名称
  rawTitle: "第一卷 ：魔性不改",
  synthetic: false,          // 序章/前言等合成卷为 true
  startOffset, headingEnd, endOffset
}
```

- `synthetic: true` 的卷没有真实卷标题，导出目录默认 `00_序章`。
- 卷内可能有 `volumeNote`（卷首语），不参与章节编号。

## 3. Chapter

```js
{
  id: "C00001",
  type: "chapter" | "preface" | "notice" | "volumeNote",
  volumeId: "V001",
  title: "第一节：纵身亡魔心仍不悔",
  rawTitle: "第一节：纵身亡魔心仍不悔",
  body: "……",               // 去掉标题行后的正文
  text: "第一节：……\n\n……", // 原始片段（含标题行）
  globalIndex: 1,            // 全书章节序号；notice/volumeNote 为 null
  localIndex: 1,             // 卷内序号；notice/volumeNote 为 null
  labelNumber: 1,
  labelUnit: "节",
  offset, endOffset,
  excluded: false,
  reasons: [],
  junkType: "normal" | "suspect" | "junk",
  junkScore: 0,
  manual: false,             // 是否被用户手动排除/恢复
  edited: false              // 标题是否被编辑
}
```

### 编号规则

- 只有 `chapter` / `preface` 参与 `globalIndex` 与 `localIndex`。
- `notice`（独立通知/请假）和 `volumeNote`（卷首语）不编号，导出文件名编号为 `0000`。
- `globalIndex` 在回读时从 manifest 恢复，不重新编号。
- 原始编号（第 X 节）保留在 `labelNumber` / `labelUnit`，导出标题不改写。

## 4. 通知与卷首语

- `notice`：由 `parser.collectNotices` 识别，要求独立成段（前后空行），如 `请假`、`今天无更`、`通知：`、`单章：`、`求月票`。
- 通知默认判定为 `junk` 并排除，可在清洗页恢复。
- `volumeNote`：卷标题与第一章之间的文本，导出为 `0000_卷首语.txt`。

## 5. 变量

### v1（已实现）

| 变量 | 含义 |
|---|---|
| `book` / `bookSafe` | 书名 / 安全化书名 |
| `volume` / `volumeTitle` | 卷原始标题 / 卷名 |
| `volumeNo` | 卷号两位补零；合成卷 `00` |
| `volumeSafe` | 安全化卷名；合成卷 `序章` |
| `chapterNo` | 全书编号四位补零；无编号 `0000` |
| `localNo` | 卷内编号四位补零 |
| `title` / `titleSafe` | 章节标题 / 安全化标题 |
| `rawTitle` | 原始标题 |
| `type` | 章节类型 |
| `date` / `ext` | 导出日期 / 扩展名 |

插件变量：`{{plugin.<id>.<name>}}`；无冲突时也可直接 `{{name}}`。

### v2（设计）

新增命名空间与派生统计：

```text
{{book.chars}}            {{book.chapterCount}}
{{volume.chars}}          {{volume.chapterCount}}
{{chapter.chars}}         {{chapter.readingMinutes}}
{{index.global}}          {{index.local}}
{{relations.prevTitle}}   {{relations.nextTitle}}
{{stats.volumeChapters}}  {{stats.firstChapterTitle}}
{{plugin.<id>.<var>}}
```

v1 扁平变量保留为兼容别名。

## 6. manifest（`novel-disassembly/1`）

```json
{
  "format": "novel-disassembly/1",
  "book": "书名",
  "exportedAt": "2026-10-17T12:00:00.000Z",
  "options": { "includeExcluded": false, "includeNotes": true, "useEditedTitles": true, "cleanWatermark": true, "cleanTrailingNotes": true },
  "plugins": [{ "id": "clean-annotations", "version": "0.1.0" }],
  "templates": { "volumeFolder": "{{volumeNo}}_{{volumeSafe}}", "chapterFile": "{{chapterNo}}_{{titleSafe}}.txt", "header": "{{title}}" },
  "volumes": [{
    "title": "第一卷 ：魔性不改",
    "number": 1,
    "name": "魔性不改",
    "synthetic": false,
    "chapters": [{
      "file": "01_魔性不改/0001_第一节：xxx.txt",
      "title": "第一节：xxx",
      "rawTitle": "第一节：xxx",
      "type": "chapter",
      "globalIndex": 1,
      "localIndex": 1,
      "labelNumber": 1,
      "labelUnit": "节",
      "excluded": false,
      "reasons": [],
      "junkType": "normal",
      "junkScore": 0
    }]
  }]
}
```

约定：

- 只记录实际写出的章节；未勾选“包含已排除章节”时，排除项不进 manifest。
- 新版写出 `novel-disassembly/1`；导入同时接受 `novel-disassembly/1` 与旧的 `rp-disassembly/1`。
- 章节文件格式 `标题\n\n正文`；回读时首行等于标题则剥离。
- 回读忽略未知字段，便于后续扩展。
- 回读是**清洗后的文本**，不等同原始素材。

## 7. Entity（v2 设计）

```js
{
  kind: "entity",
  entityType: "character" | "event" | "foreshadow" | "place" | "item",
  id: "E00001",
  name: "方源",
  aliases: ["方老魔"],
  firstSeenChapterId: "C00001",
  mentions: [{ chapterId, count }],
  summary: "……",
  meta: {}
}
```

- 由 AI 分析插件产出，核心负责存储与展示。
- JSON 导出可携带实体；TXT/ZIP/EPUB 默认不输出实体。

## 8. IndexedDB 映射

| 对象仓库 | 主键 | 内容 |
|---|---|---|
| `books` | `id` | 书元数据、统计、更新时间 |
| `sources` | `bookId` | `rawText` |
| `volumes` | `[bookId, id]` | 卷字段、`order` |
| `chapters` | `[bookId, id]` | 章节全部字段、`order` |
| `settings` | `key` | 上次书/章节/视图/筛选、导出目录句柄 |
| `pluginData` | `[pluginId, key]` | 插件独立键值数据；索引 `pluginId` |

`pluginData` 于数据库 v2 新增，主键保证不同插件（甚至同名 key）互不覆盖，索引用于按 `pluginId` 整批读取/清理。访问入口为 `ND.db.pluginGet / pluginSet / pluginDelete / pluginList / pluginClear` 与 `ND.plugins.storage(pluginId)`，全部返回 Promise。书架“清空书架”会一并清空该仓库。v1 → v2 升级只新增这一个 store，不重建或清空已有书籍数据。

## 9. JSON 导出（计划）

`export-formats` 插件将输出稳定结构：

```json
{
  "schema": "novel-disassembly/book/1",
  "book": { "title", "fileName", "stats" },
  "volumes": [{ "number", "title", "chapters": [{ "title", "type", "globalIndex", "body" }] }],
  "entities": [],
  "options": {},
  "templates": {},
  "plugins": []
}
```

字段以本文件为准；后续变更通过 `schema` 版本号区分。

## 10. 不变量

- `book.chapters` 顺序与阅读顺序一致；`volume.chapters` 是子集引用。
- 同一书内 `id` 唯一；跨书可重复，靠 `bookId` 区分。
- 修改标题/排除只影响词条，不改 `rawText`。
- 导出不修改内存中的书；插件拿到的是词条副本。

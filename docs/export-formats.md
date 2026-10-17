# 导出格式

## 1. 统一管线（已实现）

```text
书 + 选项
  → 选择词条（排除/卷首语/已排除章节）
  → 插件 normalizeEntry
  → 变量（默认 + 插件）
  → 模板（卷目录 / 章节文件名 / 内容头）
  → 格式导出（TXT / ZIP / EPUB）
  → 输出（下载 / 服务端 / 目录授权）
```

清洗选项（默认开启）：

- 清除盗版/网址水印行（`更新快`、`笔趣阁`、`www.`、`http` 等短行）
- 清除章末作者附言（后半段出现的 `ps：`、`通知：`、求票等）

清洗只作用于导出副本，不改原文。

## 2. 当前格式

### TXT

- 单文件：`<书名>_分卷.txt`
- 卷标题独占一行；章节标题 + 空行 + 正文；章节之间以 `———` 分隔
- 编码 UTF-8

### ZIP

```text
<书名>/
  目录.txt
  剔除清单.txt
  _manifest.json
  01_<卷名>/
    0001_<章节标题>.txt
    ...
```

- 每章一个 txt，内容为 `标题\n\n正文`
- 同名章节自动加 `_2`、`_3`
- 根目录名为安全化书名

### 项目目录 / 文件夹

- 与 ZIP 相同的内部结构，写入 `<项目>/export/<书名>/`
- 额外写入 `<书名>.epub`
- `file://` 模式首次需授权项目根目录；HTTP 模式直接写盘

### EPUB

- EPUB3：`mimetype`（首个、未压缩）、`META-INF/container.xml`、`OEBPS/content.opf`、`nav.xhtml`、`style.css`、每章 XHTML
- 卷目录嵌套在 nav 中；正文段落化
- 单文件 `<书名>.epub`

## 3. manifest

见 [数据模型](data-model.md)。ZIP/目录均包含，用于精确回读。

## 4. 计划中的插件格式

### Markdown（`export-formats`）

```markdown
# 第一卷 魔性不改

## 第一节：纵身亡魔心仍不悔

正文……

---

## 第二节：……

正文……
```

- 卷 `#`，章节 `##`；可选 YAML front matter（书名、卷数、节数、导出时间）
- 文件：`<书名>.md`
- 选项：是否包含卷首语、是否包含已排除、是否输出分隔线
- 编码 UTF-8；正文保留原始段落

### JSON（`export-formats`）

```json
{
  "schema": "novel-disassembly/book/1",
  "book": { "title": "书名", "fileName": "书名.txt", "stats": {} },
  "volumes": [{
    "number": 1, "title": "第一卷 魔性不改",
    "chapters": [{ "title": "第一节：……", "type": "chapter", "globalIndex": 1, "localIndex": 1, "body": "……" }]
  }],
  "entities": [],
  "options": {},
  "templates": {},
  "plugins": []
}
```

- 文件：`<书名>.json`
- 包含 AI 插件产出的实体（若有）
- 字段与 `schema` 版本绑定，详见 [数据模型](data-model.md)

### DOCX（`export-formats`）

最小 OOXML，不引第三方库：

```text
[Content_Types].xml
_rels/.rels
word/document.xml
word/styles.xml
```

- 卷标题使用 `Heading1`，章节标题 `Heading2`，正文为普通段落
- 保留段落顺序与纯文本；**不保留**图片、表格、粗体/斜体、页眉页脚
- 文件：`<书名>.docx`，ZIP store 模式（无压缩）
- 适合阅读/再加工，不适合印刷级排版

## 5. 命名与安全

- 文件名安全化：非法字符替换为 `_`，长度限制 80，Windows 保留名加前缀
- 路径按 `/` 分段校验，拒绝 `..`、绝对路径、盘符、控制字符
- 导出根目录固定为 `export/<书名>/`（或用户授权目录）
- manifest 记录插件版本与模板，便于复现

## 6. 回读

- ZIP/目录：manifest 精确还原
- 导出的 TXT：可用普通 TXT 导入重新切分（会丢失排除状态）
- Markdown/JSON/DOCX：由 `import-formats` 插件导入
- 回读得到的是清洗后的文本

## 7. 验收

- 未启用任何插件时，TXT/ZIP/EPUB 与当前版本字节一致
- `export-formats` 默认启用时，导出页出现 Markdown/JSON/DOCX
- JSON 能被再次导入且卷/章/标题/实体不丢
- DOCX 能被 Word/WPS 打开，标题层级正确
- 路径穿越与非法文件名被拒绝

## 8. 状态

| 格式 | 状态 |
|---|---|
| TXT / ZIP / EPUB / 项目目录 | 已实现 |
| Markdown / JSON / DOCX | 设计完成，待实现（官方插件） |

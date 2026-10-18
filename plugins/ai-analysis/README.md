# AI 分析插件

官方插件，`id: ai-analysis`，当前版本 `0.2.3`。通过 **OpenAI 兼容接口**手动生成逐章摘要、卷归并结果与全书大纲/设定集。只修改插件自己的数据，不影响核心拆解、清洗、导入与 TXT/ZIP/EPUB 导出。

## 用途

- **逐章分析**：每章输出不超过 150 字的摘要、关键事件、1–3 条关键原文（`keyExcerpts`），并按勾选类别抽取实体。
- **按卷归并**：使用该卷章节摘要 + 关键原文 + 已抽实体，生成卷摘要、卷大纲与卷级人物/物品/地点/势力/事件/伏笔。
- **全书汇总**：使用各卷摘要、卷大纲与卷级实体，生成全书大纲（logline、梗概、主题、分卷弧线）与合并后的设定集。
- **结果浏览**：章节摘要、大纲、人物、物品、地点势力、事件伏笔六个 Tab，只显示已勾选或有数据的类别。
- **导出**：当前书 AI 结果导出为 JSON 与 Markdown，不含 API Key 与模型配置。
- 结果按书持久化到插件存储（IndexedDB），刷新页面后仍可查看。

插件不会自动请求接口；只有点击“逐章分析”“生成大纲与设定集”“测试连接”“生成卷摘要”“生成全书摘要”时才会发送请求。

## 配置

侧栏进入“AI 分析”：

| 字段 | 说明 |
|---|---|
| 预设 | 只填充 Base URL 与建议模型，不覆盖已填写的 API Key |
| Base URL | 只填基础地址，如 `https://api.openai.com`；自动补 `/v1`，已带版本路径（`/v1`、`/api/paas/v4`）则原样使用 |
| 模型 | 可手动填写，或点“拉取模型”从 `/models` 获取候选 |
| API Key | `type=password`；Ollama 等本地服务可留空 |
| 跳过已排除章节 | 默认开启，只影响 AI 分析范围，不改变导出 |

### 生成类别

7 个复选框，默认全选，勾选变化即写入配置：

| 类别 | 作用 |
|---|---|
| 大纲 | 控制分卷大纲与全书大纲 |
| 人物 | 抽取 `character` 实体 |
| 物品/道具 | 抽取 `item` 实体 |
| 地点 | 抽取 `place` 实体 |
| 势力 | 抽取 `faction` 实体 |
| 事件 | 抽取 `event` 实体 |
| 伏笔 | 抽取 `foreshadow` 实体 |

逐章分析只要求勾选的实体类别，`summary` 与 `events` 始终返回。取消全部设定集类别后“生成大纲与设定集”会禁用并提示；只勾“大纲”时只生成卷/全书大纲。

### 按钮

- **保存配置**：写入插件存储，刷新页面后保留。
- **拉取模型**：请求 `<基础地址>/v1/models`（已带版本路径则用原路径），把返回的模型 id 填入下拉候选；可继续手动输入。
- **测试连接**：发送“回复 OK”的最小请求（`max_tokens: 8`），不写入分析结果。
- **清除 Key**：清空 API Key 并保存配置。

### 预设

| 预设 | Base URL | 建议模型 |
|---|---|---|
| OpenAI | `https://api.openai.com` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| Ollama | `http://127.0.0.1:11434` | `qwen2.5:7b` |
| 自定义 | 空 | 空 |

## 分析范围与 token

- **当前章**：阅读页当前选中的章节。
- **指定卷**：下拉选择卷。
- **全书**：当前书的全部章节。

开启“跳过已排除章节”时，已排除的通知、请假等不会发送。逐章单次最多 50 章；超出时提示缩小范围，不会自动截断。

估算方式：

| 阶段 | 输入 | 输出 |
|---|---|---|
| 逐章 | 正文总字数 ÷ 2 | 约 300 token / 章 |
| 卷归并 | 卷内章节摘要 + 关键原文 + 实体文本字数 ÷ 2 | 约 800 token / 卷 |
| 全书汇总 | 卷摘要 + 卷大纲 + 卷级实体文本字数 ÷ 2 | 约 1500 token |

界面与确认框显示章节数、卷数、阶段与估算值；估算仅供参考，实际以服务商账单为准。

## 流程

```text
逐章分析（可停止）
  → 每章写入存储（失败章节记录错误并继续）
生成大纲与设定集（需已有章节摘要）
  → 确认章节/卷数量与 token 估算
  → 顺序按卷归并（每卷完成即写入）
  → 全书汇总（基于卷结果，不再发送章节全文）
  → 客户端按名称+别名二次去重
  → 写入 outline / encyclopedia / entityMeta
```

- 两个流程共用“停止”，停止后保留已完成结果。
- 归并阶段失败会记录卷错误并继续其他卷；全书汇总只使用成功的卷结果。
- 没有章节摘要时“生成大纲与设定集”禁用，并提示先逐章分析。

## API 调用

```text
POST <归一化 Base URL> + /chat/completions
GET  <归一化 Base URL> + /models
Content-Type: application/json
Authorization: Bearer <API Key>   // Key 非空时
```

Base URL 归一化：去掉末尾 `/`、`/chat/completions`、`/models`；若已包含 `/v1`、`/v2`、`/api/paas/v4` 等版本段则原样使用，否则自动追加 `/v1`。

```json
{
  "model": "模型名",
  "messages": [],
  "temperature": 0.2,
  "max_tokens": 800
}
```

`max_tokens`：逐章 800、卷归并 1200、全书汇总 2000、摘要 800。超时 90 秒（`AbortController`）。Base URL 会先归一化（补 `/v1`、去掉 `/chat/completions` 或 `/models`）再拼接端点。

响应解析兼容常见变体：`choices[0].message.content`（字符串/数组/对象）、`choices[0].text`、`{data|result}.choices`、`output_text`/`output[]`、Anthropic `content[]`、Ollama `message.content`、Gemini `candidates[]`、纯文本 `text`/`response`。请求体仍是 OpenAI Chat Completions 格式；不是完整协议适配器。无法识别时会报错并附上脱敏后的原始响应摘要（最多 400 字）。

请求优先直连；通过 `start.bat` 以 HTTP 打开时，若直连被 CORS 拦截会自动改走本地 `/api/ai/proxy`。

## Prompt 与返回

所有请求要求“严格只输出 JSON，不要 Markdown 代码块”。

### 逐章

输入章节标题 + 正文（最多 8000 字），只列出勾选实体类型。返回：

```json
{
  "summary": "不超过150字",
  "events": ["关键事件"],
  "keyExcerpts": ["1-3条原文短句，每条不超过80字"],
  "entities": [
    {
      "type": "character|item|place|faction|event|foreshadow",
      "name": "", "aliases": [], "note": "", "role": "", "faction": "",
      "function": "", "owner": "", "chapter": "", "setup": "", "payoff": "",
      "status": "", "importance": ""
    }
  ]
}
```

解析时按类型归一化，忽略未勾选类别；`keyExcerpts` 截断到最多 3 条、每条 80 字。

### 卷归并

输入卷标题 + 该卷所有已完成章节的标题/摘要/关键事件/关键原文/实体，总长约 12000 字。返回：

```json
{
  "volumeSummary": "200字内",
  "outline": { "summary": "卷大纲", "keyEvents": ["..."] },
  "characters": [], "items": [], "places": [],
  "factions": [], "events": [], "foreshadows": []
}
```

只输出勾选类别；未勾选“大纲”时省略 `outline`。

### 全书汇总

输入各卷 `volumeSummary + outline + 实体`，总长约 16000 字；不再发送章节全文或章节摘要。返回：

```json
{
  "outline": {
    "logline": "一句话",
    "synopsis": "全书梗概 300-600 字",
    "themes": ["主题"],
    "arcs": [{ "title": "卷/阶段名", "summary": "", "keyEvents": [], "chapters": "" }]
  },
  "characters": [], "items": [], "places": [],
  "factions": [], "events": [], "foreshadows": []
}
```

模型按名称/别名合并重复项，客户端再按归一化名称+别名做一次去重，保留首次出现的名称与描述。

## 结果存储

插件存储键：

- `config`：配置对象（含明文 Key）。
- `book:<bookId 或 fileName>`：

```js
{
  chapters: {
    [chapterId]: {
      title, summary, events: [], keyExcerpts: [],
      entities: [{ type, name, aliases, note, role, ... }],
      model, at, error?
    }
  },
  volumeSummaries: {
    [volumeId]: {
      summary, at,
      outline: { summary, keyEvents: [] } | null,
      entities: { characters: [], items: [], places: [], factions: [], events: [], foreshadows: [] },
      error?
    }
  },
  bookSummary: { summary, at },
  outline: {
    logline, synopsis, themes: [],
    arcs: [{ title, summary, keyEvents: [], chapters }],
    at, model
  },
  encyclopedia: {
    characters: [{ name, aliases: [], role, faction, description, arc, firstChapter, importance }],
    items: [{ name, type, function, owner, description, firstChapter }],
    places: [{ name, type, description, firstChapter }],
    factions: [{ name, type, description, firstChapter }],
    events: [{ name, chapter, description, significance }],
    foreshadows: [{ name, setup, payoff, status, description }]
  },
  entityMeta: { lastRunAt, categories: [] },
  updatedAt
}
```

- 每章、每卷完成后立即写入；刷新或重新打开同一本书后仍在。
- 旧版数据缺少 `keyExcerpts / outline / encyclopedia / entityMeta` 时按空处理，不会清空已有 `chapters`。
- `volumeSummaries` 在旧结构上增加了 `outline / entities / error`，用于全书汇总和卷级设定集展示。
- “清空本书结果”需确认，只清除当前书的 AI 结果，不影响配置与核心数据。
- 切换书籍时重新读取当前书与结果；没有导入书时显示提示。
- 清除站点数据、使用隐私模式或更换浏览器会丢失结果与 Key。

## 导出

“导出 JSON”包含 `outline`、`encyclopedia`、章节摘要/实体、卷摘要、`categories`、导出时间与书名；不包含 `config`、API Key 或请求日志。

“导出 Markdown”按大纲、人物、物品、地点、势力、事件、伏笔分节输出，并附章节摘要；表格中的换行与竖线会转义。

文件通过 Blob + `<a download>`（优先 `ND.downloadBlob`）下载，不经过服务器。

## 费用与隐私

- 只发送选中章节的标题与正文（正文最多 8000 字）；归并只发送摘要、关键原文与实体；全书汇总只发送卷级结果。
- 第三方服务会收到正文/摘要，可能按其政策记录日志。敏感内容请使用本地 Ollama 或可信的兼容代理。
- **API Key 以明文保存在当前浏览器的 IndexedDB 插件存储中**，不会写入导出文件、模板或日志。共享电脑或浏览器配置前请先“清除 Key”。
- 请求失败时仅显示服务商返回的错误摘要，不打印 Key 或完整请求体。

## CORS

浏览器直连要求服务商允许跨域（CORS）。若出现“网络请求失败：可能是 CORS 限制…”，可：

1. **用 `start.bat` 启动**：插件直连失败时会自动改走本地 `POST /api/ai/proxy`，由 `serve.py` 转发请求；代理仅本机可用，限制 GET/POST、http/https、5MB 请求与 20MB 响应，不记录 Key（推荐）。
2. 改用本地 Ollama（`http://127.0.0.1:11434`）。
3. 使用允许 CORS 的兼容代理/网关，或换用支持浏览器直连的服务商。

`file://` 双击模式没有本地服务，无法使用代理；自定义接口仍需服务商允许 CORS。

## 限制

- 仅支持 OpenAI Chat Completions 兼容协议；不兼容 Responses API、Anthropic 原生协议等。
- 顺序执行，无并发、无自动重试、无断点续跑、无费用上限。
- 逐章单次 50 章上限；长章节只发送前 8000 字。
- 卷归并/全书汇总基于已有摘要与实体二次生成，不读取全文；质量受逐章结果影响。
- 归并失败会继续其他卷；全书汇总跳过失败卷，结果可能不完整。
- 结果只存在插件存储与本次导出中，尚未写入核心 JSON/词条/manifest；TXT/ZIP/EPUB 导出不受影响。
- 插件视图没有卸载钩子，刷新/停用插件后由宿主重建视图。

# AI 分析插件（设计）

## 1. 定位

- 官方插件 `ai-analysis`，**默认启用但空闲**：未配置模型前不发起任何请求，只显示入口与配置。
- 仅手动触发：用户选择范围、勾选类别、看到 token 估算、确认后才调用。
- 输出：逐章摘要与关键原文、卷归并结果、全书大纲与设定集（人物/物品/地点/势力/事件/伏笔）。
- 不改变核心拆解、清洗与 TXT/ZIP/EPUB 导出；结果只写入插件存储，可单独导出 JSON/Markdown。

## 2. 配置

预设（OpenAI 兼容）：

| 预设 | Base URL 示例 | 说明 |
|---|---|---|
| OpenAI | `https://api.openai.com` | 需 key；自动补 `/v1` |
| DeepSeek | `https://api.deepseek.com` | 需 key；自动补 `/v1` |
| GLM | `https://open.bigmodel.cn/api/paas/v4` | 需 key；保留版本路径 |
| Ollama | `http://127.0.0.1:11434` | 通常无需 key；自动补 `/v1` |
| 自定义 | 用户填写 | 自动补 `/v1`，已带版本路径则原样使用 |

配置对象：

```js
{
  preset, baseUrl, model, apiKey, skipExcluded,
  categories: ["outline", "characters", "items", "places", "factions", "events", "foreshadows"]
}
```

- `categories` 默认全选；复选框变化立即写入配置，点“保存配置”也会保存。
- **Base URL 归一化**：去掉末尾 `/`、`/chat/completions`、`/models`；若已包含 `/v1`、`/v2`、`/api/paas/v4` 等版本段则原样使用，否则自动追加 `/v1`。
- **拉取模型**：`GET <归一化 Base URL>/models`，把返回的模型 id 填入输入框下拉候选；失败时保留手动输入。
- Key 只保存在本地 IndexedDB（插件命名空间），不写入仓库、导出文件或日志。

## 3. 触发与流程

```text
选择范围（当前章 / 指定卷 / 全书）
  → 估算逐章 token
  → 用户确认
  → 顺序逐章请求（summary/events/keyExcerpts/entities，失败继续）
  → 已有章节摘要
  → 选择“生成大纲与设定集”
  → 确认章节数、卷数与归并 token 估算
  → 顺序卷归并（摘要 + 关键原文 + 已抽实体）
  → 全书汇总（卷摘要 + 卷大纲 + 卷级实体）
  → 客户端按名称+别名去重
  → 写入插件存储
```

- 逐章与归并均顺序执行，两个流程共用“停止”；停止后保留已完成结果。
- **MVP 现状**：无并发、自动重试、费用上限与断点续跑。
- 每章记录 `summary / events / keyExcerpts / entities / error`；失败章节记录错误并继续。
- 卷归并每卷完成立即写入；失败的卷记录错误并继续。全书汇总只使用成功的卷。
- 没有章节摘要时，“生成大纲与设定集”禁用并提示先逐章分析。

## 4. 输入与输出

### 输入

- 单章：标题 + 正文（最多 8000 字）。
- 卷归并：卷标题 + 该卷已完成章节的标题、摘要、关键事件、关键原文、已抽实体，总长约 12000 字。
- 全书汇总：各卷摘要 + 卷大纲 + 卷级实体，总长约 16000 字；不发送章节全文或章节摘要。
- 只向模型列出勾选的实体类别；`summary / events` 始终返回。

### 逐章输出

```json
{
  "summary": "不超过150字",
  "events": ["关键事件"],
  "keyExcerpts": ["1-3条原文短句，每条不超过80字"],
  "entities": [
    {
      "type": "character|item|place|faction|event|foreshadow",
      "name": "", "aliases": [], "note": "", "role": "",
      "faction": "", "function": "", "owner": "", "chapter": "",
      "setup": "", "payoff": "", "status": "", "importance": ""
    }
  ]
}
```

### 卷归并输出

```json
{
  "volumeSummary": "200字内",
  "outline": { "summary": "卷大纲", "keyEvents": ["..."] },
  "characters": [], "items": [], "places": [],
  "factions": [], "events": [], "foreshadows": []
}
```

只输出勾选类别；未勾选“大纲”时省略 `outline`。

### 全书汇总输出

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

- 实体字段与存储结构一致（见第 6 节）。
- 模型先按名称/别名去重；解析后再在客户端做一次归一化去重，保留首次出现的名称与描述。
- 不修改原文、标题、排除状态。

## 5. 费用与隐私

- 调用前显示：预计输入 token、输出 token（逐章 300/章、卷 800/卷、全书 1500）。
- 只发送用户选中的章节文本或二次生成结果；不上传整本书元数据（可选发送书名）。
- 提示：第三方 API 会收到文本，可能被用于服务商日志；敏感内容不要使用云端模型。
- CORS：部分服务商禁止浏览器直连；用 `start.bat` 启动时，直连失败会自动改走本地 `POST /api/ai/proxy`（仅本机、限 GET/POST/http(s)/5MB 请求/20MB 响应，不记录 Key）。`file://` 双击模式没有本地服务，无法使用该代理。
- `max_tokens`：逐章 800、卷归并 1200、全书 2000；`temperature: 0.2`；超时 90 秒。

## 6. 存储

- 插件存储（IndexedDB `pluginData`，按 `pluginId` 隔离）：
  - `config`：含类别与明文 Key；
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
  outline: { logline, synopsis, themes: [], arcs: [], at, model },
  encyclopedia: {
    characters: [], items: [], places: [], factions: [], events: [], foreshadows: []
  },
  entityMeta: { lastRunAt, categories: [] },
  updatedAt
}
```

- 章节按 `chapterId` 保存，每章完成后立即写入；卷结果每卷完成后写入。
- 旧版数据缺少新字段时按空处理，不清空已有 `chapters`。
- 实体目前只存在插件存储中，尚未写入 v2 `entity` 词条集合，也不进入核心 manifest。
- 导出 JSON/Markdown 只从插件结果构造，不包含配置或 Key。

## 7. UI

- 侧栏“AI 分析”视图：
  - 配置区（预设、Base URL、模型、Key、跳过排除、7 个类别复选框）
  - 范围选择与逐章 token 预估
  - “逐章分析”“生成大纲与设定集”“停止”
  - 归并就绪提示与 token 估算
  - 结果 Tab：章节摘要 / 大纲 / 人物 / 物品 / 地点势力 / 事件伏笔
  - 导出 JSON / 导出 Markdown / 生成全书摘要 / 清空本书结果
- Tab 只在对应类别勾选或有数据时显示；无数据时显示空状态。
- 章节 Tab 显示摘要、关键事件、关键原文、实体与错误；大纲 Tab 显示 logline、梗概、主题和分卷弧线；其余 Tab 使用实体卡片分组。
- 进度显示“逐章 3/10”“卷归并 2/6”“全书汇总”，失败继续，可停止。
- 未配置时按钮禁用并提示配置；没有章节摘要时归并按钮禁用。

## 8. 失败与边界

- API 返回非 JSON：记录原始片段，标记失败，不污染实体。
- 401 / 403 / 404 / 429 / 5xx：显示可读错误；CORS/网络错误提示可能原因。
- 超时：90 秒后中止当前请求；停止会中止正在进行的请求。
- 单章失败：覆盖该章结果为错误条目，其他章节保留；归并失败：记录卷错误，其他卷继续。
- 全书汇总失败：保留卷级结果与已有全书大纲/设定集，不清空。
- 用户取消：停止后续批次，保留已完成结果。
- 不自动运行、不在后台偷偷调用。

## 9. 验收

- 未配置时不发请求，导出行为不变。
- 逐章摘要、关键原文与实体成功并持久化，刷新后仍在。
- 类别勾选持久化；只勾人物+物品时逐章 prompt 与结果都只包含对应实体。
- 逐章批处理可停止，保留已完成结果；失败章节记录错误并继续。
- 生成大纲与设定集：分卷归并 + 全书汇总顺序执行，可停止；执行前显示章节/卷数与 token 估算。
- 大纲、人物、物品、地点/势力、事件、伏笔 Tab 有数据且重复实体合并。
- JSON/Markdown 导出包含大纲与设定集，不含 API Key。
- 旧版存储数据可读；清空本书结果会移除全部 AI 数据。
- Key 不出现在导出文件或仓库中（本地 IndexedDB 明文保存）。

## 10. 状态

**已实现（0.2.3）**：官方插件 `plugins/ai-analysis/`。

### 已实现

- OpenAI 兼容直连：Base URL、模型、API Key、预设；Key 只存插件存储。
- 手动触发，顺序执行：当前章 / 指定卷 / 全书，单次最多 50 章。
- 7 个生成类别，默认全选，修改即保存；逐章 prompt 与解析按类别过滤。
- 逐章摘要、关键事件、`keyExcerpts`、人物/物品/地点/势力/事件/伏笔实体。
- 按卷归并：卷摘要、卷大纲、卷级设定集；每卷完成即持久化。
- 全书汇总：logline、300-600 字梗概、主题、分卷弧线；合并后的设定集。
- 客户端名称+别名去重；旧数据兼容。
- 结果 Tab、进度、停止、失败继续；执行前确认与 token 估算。
- 导出 JSON/Markdown；不含 API Key。
- 结果按书持久化，刷新后保留；支持清空本书结果。
- 401 / 429 / CORS / 超时的可读错误提示。
- Base URL 自动补 `/v1`；`GET /models` 拉取模型候选；HTTP 模式下 CORS 失败自动经本地 `/api/ai/proxy` 重试。
- 响应解析兼容 `choices[0].message.content`（字符串/数组/对象）、`choices[0].text`、`{data|result}.choices`、`output_text`/`output[]`、Anthropic `content[]`、Ollama `message.content`、Gemini `candidates[]`、纯文本；无法识别时附脱敏原始响应摘要（400 字）。
- 所有正文与摘要使用 `textContent` 渲染，避免 XSS。

### 未实现

- 完整协议适配器（Anthropic/Gemini 原生请求体）；当前请求体仍为 OpenAI Chat Completions。
- SSE / 流式响应解析。
- 并发请求、自动重试与指数退避。
- 成本价格表与费用上限；仅显示 token 估算。
- 断点续跑与逐章重试/跳过按钮。
- 阅读页/卷目录的快捷生成入口（当前只在 AI 分析视图内操作）。
- 实体写入 v2 词条，或进入核心 JSON/manifest；TXT/ZIP/EPUB 不输出 AI 结果。
- 请求日志、实际 token 用量统计与多模型对比。
- 归并结果的人工编辑与冲突合并界面。

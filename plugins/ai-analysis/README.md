# AI 分析插件

官方插件，`id: ai-analysis`。通过 **OpenAI 兼容接口**手动生成章节摘要、卷摘要与全书摘要，并抽取人物、事件、伏笔。只修改插件自己的数据，不影响核心拆解、清洗、导入与导出。

## 用途

- 章节摘要：每章输出不超过 150 字的摘要、关键事件与实体。
- 卷摘要：用已完成章节摘要汇总本卷，200 字以内。
- 全书摘要：优先汇总卷摘要，没有卷摘要时使用章节摘要。
- 结果按书持久化到插件存储（IndexedDB），刷新页面后仍可查看。

插件不会自动请求接口；只有点击“开始分析”“测试连接”“生成卷摘要”“生成全书摘要”时才会发送请求。

## 配置

侧栏进入“AI 分析”：

| 字段 | 说明 |
|---|---|
| 预设 | 只填充 Base URL 与建议模型，不覆盖已填写的 API Key |
| Base URL | 接口根地址，如 `https://api.openai.com/v1` |
| 模型 | 服务商提供的模型名 |
| API Key | `type=password`；Ollama 等本地服务可留空 |
| 跳过已排除章节 | 默认开启，只影响 AI 分析范围，不改变导出 |

按钮：

- **保存配置**：写入插件存储，刷新页面后保留。
- **测试连接**：发送“回复 OK”的最小请求（`max_tokens: 8`），不写入分析结果。
- **清除 Key**：清空 API Key 并保存配置。

### 预设

| 预设 | Base URL | 建议模型 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| Ollama | `http://127.0.0.1:11434/v1` | `qwen2.5:7b` |
| 自定义 | 空 | 空 |

## 分析范围

- **当前章**：阅读页当前选中的章节。
- **指定卷**：下拉选择卷。
- **全书**：当前书的全部章节。

开启“跳过已排除章节”时，已排除的通知、请假等不会发送。单次最多 50 章；超出时提示缩小范围，不会自动截断。界面显示章节数、预计输入 token（正文总字数 ÷ 2，向上取整）与预计输出 token（每章 300）。

开始前会弹出确认框，显示章节数与估算值。分析按章节顺序执行，不并发；停止后保留已完成结果。单章失败会记录错误并继续下一章。

## API 调用

```text
POST <Base URL 去掉末尾 /> + /chat/completions
Content-Type: application/json
Authorization: Bearer <API Key>   // Key 非空时
```

```json
{
  "model": "模型名",
  "messages": [],
  "temperature": 0.2,
  "max_tokens": 800
}
```

超时 90 秒（`AbortController`），读取 `choices[0].message.content`。若 Base URL 已以 `/chat/completions` 结尾则不再追加。请求直接从浏览器发往服务商，不经过本项目服务器。

## 费用与隐私

- 只发送选中章节的标题与正文（正文最多 8000 字）；摘要请求只发送已有摘要。
- 第三方服务会收到正文，可能按其政策记录日志。敏感内容请使用本地 Ollama 或可信的兼容代理。
- 本项目不做 token 计费，也不内置价格表；预计 token 仅供参考，实际以服务商账单为准。
- **API Key 以明文保存在当前浏览器的 IndexedDB 插件存储中**，不会写入导出文件、模板或日志。共享电脑或浏览器配置前请先“清除 Key”。
- 请求失败时仅显示服务商返回的错误摘要，不打印 Key 或完整请求体。

## CORS

浏览器直连要求服务商允许跨域（CORS）。若出现“网络请求失败：可能是 CORS 限制…”，可：

1. 改用本地 Ollama（`http://127.0.0.1:11434/v1`）；
2. 使用允许 CORS 的兼容代理/网关；
3. 换用支持浏览器直连的服务商。

本项目不提供代理服务器，也不会绕过同源策略。

## 结果存储

插件存储键：

- `config`：配置对象（含明文 Key）。
- `book:<bookId 或 fileName>`：

```js
{
  chapters: {
    [chapterId]: {
      title, summary, events: [], entities: [{ type, name, aliases, note }],
      model, at, error?
    }
  },
  volumeSummaries: { [volumeId]: { summary, at } },
  bookSummary: { summary, at },
  updatedAt
}
```

- 每章处理完成后立即写入；刷新或重新打开同一本书后仍在。
- “清空本书结果”需确认，只清除当前书的 AI 结果，不影响配置与核心数据。
- 切换书籍时重新读取当前书与结果；没有导入书时显示提示。
- 清除站点数据、使用隐私模式或更换浏览器会丢失结果与 Key。

## 限制

- 仅支持 OpenAI Chat Completions 兼容协议；不兼容 Responses API、Anthropic 原生协议等。
- 顺序执行，无并发、无自动重试、无断点续跑、无费用上限。
- 全书/卷摘要基于已有摘要二次生成，不读取全文；摘要质量受章节摘要影响。
- 结果暂不参与 JSON/Markdown 导出，也不写入 manifest；TXT/ZIP/EPUB 导出不受影响。
- 单次 50 章上限；长章节只发送前 8000 字。
- 插件视图没有卸载钩子，刷新/停用插件后由宿主重建视图。

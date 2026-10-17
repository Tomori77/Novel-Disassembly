# 插件系统

## 1. 目标

- 核心保持“拆解 + 宿主 + I/O + 壳”，格式、分析、清洗规则通过插件扩展。
- 插件默认是本地经典脚本，兼容 `file://`，不联网安装。
- v1 已上线并保持兼容；v2 增加导入/导出/UI/存储/实体能力。

当前完整 API 参考：[`plugins/API.md`](../plugins/API.md)。插件化拆分路线：[`plugins/ARCHITECTURE.md`](../plugins/ARCHITECTURE.md)。

## 2. v1（已实现）

### 2.1 注册

```js
ND.plugins.register({
  id: "clean-annotations",
  name: "去除更新标注",
  version: "0.1.0",
  apiVersion: 1,
  priority: 100,
  description: "……",
  hooks: {
    normalizeEntry(entry, ctx) { /* 修改并返回 entry */ },
    defineVariables(entry, ctx) { return { cleanTitle: entry.chapter.title }; }
  }
});
```

- `normalizeEntry` 按 `priority` 升序执行；返回 `entry` 或 `undefined`。
- `defineVariables` 返回值以 `{{name}}`（无冲突时）和 `{{plugin.<id>.<name>}}` 暴露。
- 插件异常被捕获并记录，不中断导出。
- `apiVersion !== 1` 视为不兼容，不执行钩子。
- 全局命名空间为 `window.ND`；`window.RP` 是永久兼容别名，旧插件里的 `RP.plugins.register` 无需修改仍可注册。

### 2.2 宿主 API

```js
ND.plugins.register(def)
ND.plugins.list()
ND.plugins.load()
ND.plugins.normalize(entry, ctx)
ND.plugins.variables(entry, ctx)
ND.plugins.render(template, vars)
ND.plugins.templates() / setTemplates(patch)
ND.plugins.isEnabled(id) / setEnabled(id, bool)
ND.plugins.safePath(value, fallback)
ND.plugins.status()
```

### 2.3 清单与加载

```text
plugins/
├─ index.js                  # window.ND_PLUGIN_INDEX = [...]
├─ <id>/
│  ├─ plugin.json            # id/name/version/apiVersion/entry/enabled/priority
│  ├─ index.js               # 调用 ND.plugins.register
│  └─ README.md
├─ _template/                # 新建插件模板
└─ schema/plugin.schema.json
```

- `tools/build-plugins.ps1` 扫描 `plugin.json`，生成 `plugins/index.js`，写入 `window.ND_PLUGIN_INDEX`。
- 加载器优先读取 `window.ND_PLUGIN_INDEX`，回退到旧的 `window.RP_PLUGIN_INDEX`；加载前会清空两者。
- 页面启动时动态插入 `<script src="plugins/index.js">`，再按 priority 加载各插件脚本。
- 未显式开关时使用 manifest 的 `enabled`；用户开关存 `localStorage`（`novel-disassembly-plugin-state-v1`）。

### 2.4 生命周期

```text
页面加载
  → plugins.load()：读清单 → 注册记录 → 按序加载脚本
  → 导出：collect → prepareItem → normalize → variables → render → 输出
```

- 插件在章节收集之后运行，不能改变本轮导出的章节集合，只能规范化词条。
- 插件加载是异步的；加载完成前立即导出不会包含插件。

## 3. v2（设计）

### 3.1 能力声明

插件在 manifest 中声明 `provides` 与能力：

```json
{
  "apiVersion": 2,
  "provides": ["exporter.markdown", "stats.readingMinutes"],
  "capabilities": ["exporter", "ui"]
}
```

| 能力 | 输入 → 输出 | 时机 |
|---|---|---|
| `importers` | File → entries | 导入 |
| `classifiers` | entry → flags/score | 切分后 |
| `normalizers` | entry → entry | 导出前/预览 |
| `variables` | entry → vars | 模板渲染 |
| `exporters` | exportPlan + entries → `{fileName, blob}` | 导出 |
| `ui` | slot + context | 界面 |
| `lifecycle` | context | 书加载/切分/导出前后 |

### 3.2 导出插件

```js
ND.plugins.register({
  id: "markdown-exporter",
  apiVersion: 2,
  exporters: [{
    id: "markdown",
    label: "Markdown",
    extension: "md",
    async build(plan) {
      const text = plan.entries.map((e) => `## ${e.chapter.title}\n\n${e.chapter.body}`).join("\n\n");
      return { fileName: plan.book.title + ".md", blob: new Blob([text], { type: "text/markdown" }) };
    }
  }]
});
```

`plan` 由核心生成，包含：书、卷、章节、变量、排除规则、模板、manifest。导出插件不重新实现切分与命名。

### 3.3 导入插件

```js
{
  id: "epub",
  extensions: ["epub"],
  async parse(file, ctx) {
    // 返回 { book, entries } 或 entries
  }
}
```

导入插件负责把外部格式转成 v2 词条；核心负责落库、书架、后续清洗与导出。

### 3.4 UI 插槽

```js
ui: {
  views: [{ id: "search", label: "搜索", mount(el, ctx) {} }],
  panels: [{ slot: "reader.side", mount(el, ctx) {} }],
  actions: [{ slot: "export.formats", label: "Markdown", run(ctx) {} }],
  settings: [{ id: "ai", label: "AI", mount(el, ctx) {} }]
}
```

- 只暴露固定 slot（侧栏视图、阅读侧栏、导出格式区、设置页），不提供任意 DOM 替换。
- 插件仍拥有页面权限，只启用可信代码。

### 3.5 插件存储

```js
const store = ND.core.store("ai-analysis");
await store.set("config", {...});
await store.get("config", null);
```

- 键前缀 `plugin:<id>:`，与核心表隔离。
- 可存配置、摘要、实体、任务进度；清除插件时一并清理。

### 3.6 变量目录

插件声明 `provides`，核心汇总为变量目录，在插件页与模板编辑器展示：

```text
stats.readingMinutes      ai-analysis
plugin.ai-analysis.chars  ai-analysis
chapter.chars              core
```

### 3.7 兼容策略

- v1 字段与钩子保持不变。
- v2 插件与 v1 插件可共存；按 `apiVersion` 分流。
- 导出 manifest 记录插件 id/version，便于回读与问题定位。
- 不兼容插件只提示、不加载，不影响其它插件与核心。

## 4. 排序与错误

- 顺序：`priority` 升序，其次注册顺序。
- `normalize` 逐条执行，异常记录到插件记录，继续下一条。
- `exporters` 单个失败只影响该格式，其它导出不受影响。
- 导入插件失败时回滚，不写入半成品书。

## 5. 安全

- 仅本地脚本；不提供远程加载/市场。
- 插件拥有页面权限，等同于在页面执行 JS；只启用可信代码。
- 写盘仍由核心 `export-target` 执行，插件拿不到任意路径写权限。
- 插件不得读取/提交密钥；AI key 由核心设置页管理。

## 6. 验收

- v1 插件在 v2 宿主下行为不变。
- 关闭所有插件时，核心 TXT/ZIP/EPUB 导出字节不变。
- 两个官方格式插件默认启用时，导出页/导入入口自动出现。
- 插件异常不影响核心导出与会话。

# 插件 API

版本：`apiVersion: 1`

本文档描述 Novel-Disassembly 的导出插件接口、词条模型、加载流程、变量、模板与安全边界。插件是普通经典脚本（非 ES module），通过 `window.ND.plugins.register(def)` 注册，兼容 `file://` 双击打开。

> 兼容性：`window.RP = window.ND` 是永久保留的别名，旧插件里的 `RP.plugins.register` 仍然有效，无需修改。

---

## 1. 快速示例

```js
(function () {
  "use strict";
  if (!window.ND || !window.ND.plugins) return;

  ND.plugins.register({
    id: "clean-annotations",
    name: "去除更新标注",
    version: "0.1.0",
    apiVersion: 1,
    priority: 100,
    description: "去掉标题末尾的更新标注",
    hooks: {
      normalizeEntry: function (entry, ctx) {
        entry.chapter.title = entry.chapter.title.replace(/（为[^）]*加更）$/, "");
        return entry;
      },
      defineVariables: function (entry, ctx) {
        return { cleanTitle: entry.chapter.title };
      },
    },
  });
})();
```

`plugin.json` 只用于生成清单和展示；实际行为以 `index.js` 中的 `register` 为准。

---

## 2. 词条模型

导出前，每个章节会被包装成一个可变对象：

```js
{
  book: {
    name,      // 书名（去掉 .txt 后缀）
    fileName   // 原始文件名，如 "蛊.txt"
  },
  volume: {
    id,        // "V001"
    title,     // 原始卷标题，如 "第一卷 ：魔性不改"
    number,    // 卷号数字或 null
    name,      // 卷名，如 "魔性不改"
    synthetic, // 是否为自动补出的序章卷
    index      // 扩展字段：卷在数组中的下标，用于 number 为空时回退编号
  },
  chapter: {
    id,        // "C00001"
    type,      // chapter / preface / volumeNote / notice
    title,     // 当前导出标题（已按“使用编辑后的标题”选项解析）
    rawTitle,  // 原始标题
    body,      // 已按导出清洗选项处理后的正文
    excluded,  // 是否被排除
    reasons    // 排除原因数组
  },
  index: {
    global,      // 全书内容编号或 null
    local,       // 卷内编号或 null
    labelNumber, // 标题里解析出的“第 X 节”编号或 null
    labelUnit    // "节" / "章" / "回" / ""
  },
  meta: {}       // 插件自由使用的元数据，同一词条内共享
}
```

`normalizeEntry` 可以直接修改 `entry`，也可以返回一个新对象。返回 `undefined` / `null` 表示沿用当前对象。

> 注意：插件只影响**导出**，不修改编辑界面中的标题、排除状态或原文。`excluded` 在收集导出章节之后才交给插件，因此修改它不会增加或删除本轮文件。

`ctx`：

```js
{
  book,      // 与 entry.book 相同
  options,   // 规范化后的导出选项
  variables  // 当前词条的默认变量（normalizeEntry 每步会刷新）
}
```

---

## 3. 生命周期与加载顺序

1. `index.html` 先加载 `js/plugins.js`。
2. `js/app.js` 初始化时调用 `ND.plugins.load()`。
3. 加载器插入 `plugins/index.js`，优先读取 `window.ND_PLUGIN_INDEX`，缺失时回退到旧的 `window.RP_PLUGIN_INDEX`（加载前两者都会清空）。
4. 按 `priority` 升序（同优先级按清单顺序）依次插入插件入口脚本。
5. 插件脚本调用 `ND.plugins.register(def)`。
6. 加载完成后，宿主把已启用插件的 `ui.views` 渲染成侧栏导航与视图容器（见第 5 节）。
7. 每次导出时：
   - 构造词条；
   - 按 `priority` 升序执行所有已启用、兼容、已注册插件的 `normalizeEntry`；
   - 计算默认变量；
   - 按同样顺序执行 `defineVariables`；
   - 渲染模板，生成路径、文件名、内容头；
   - 写出 TXT / ZIP / 文件夹 / EPUB。

显式开关（localStorage）优先于 `plugin.json` 的 `enabled`。开关即时生效，不需要重新加载脚本。

`ND.plugins.load()` 返回 Promise；刷新按钮会移除旧脚本、清空注册表并重新加载。

---

## 4. 钩子

### `normalizeEntry(entry, ctx)`

按 `priority` 升序执行。返回值：

- `entry`：使用返回对象；
- `undefined` / `null`：使用当前对象；
- 其他类型：忽略。

可以修改标题、正文、编号、类型、`meta` 等。异常会被捕获并记录到插件页，不中断导出。

### `defineVariables(entry, ctx)`

在 `normalizeEntry` 全部执行后调用。返回一个普通对象：

```js
return { cleanTitle: entry.chapter.title };
```

变量会同时暴露为：

- `{{plugin.<id>.<name>}}`：始终可用；
- `{{name}}`：仅当与默认变量及其他插件变量不冲突时可用。

`entry` 此时已规范化，`meta` 可用于在 `normalizeEntry` 与 `defineVariables` 之间传递数据。

### 预留钩子（尚未实现）

以下钩子已写入文档与 schema，但当前版本不会调用：

- `beforeExport(book, ctx)`：导出前一次性处理全书；
- `exporters`：注册自定义导出器；
- `afterImport(book, ctx)`：导入后处理。

插件可以声明它们，但不要依赖其执行。后续版本会在不破坏 API 1 的前提下启用。

---

## 5. UI 视图

插件可以在侧栏注册一个或多个视图。宿主在 `.nav` 末尾追加导航按钮，在 `.content` 末尾追加对应的 `<section class="view">`，延迟到第一次显示时才调用 `mount`。

```js
ND.plugins.register({
  id: "ai-analysis",
  name: "AI 分析",
  version: "0.1.0",
  apiVersion: 1,
  priority: 100,
  ui: {
    views: [
      {
        id: "ai",              // 插件内唯一
        label: "AI 分析",       // 侧栏文字
        mount: function (el, ctx) {
          // 首次显示时调用一次；el 是空的 <div class="panel plugin-view">
          el.textContent = "尚未分析";
          var book = ctx.getBook();
          if (book) el.textContent = "当前书：" + book.title;
        },
        onShow: function (ctx) {
          // 可选；之后每次切换到该视图都会调用
        },
      },
    ],
  },
});
```

约束与行为：

- `id` 必须是非空字符串且在插件内唯一；`mount` 必须是函数。无效视图会被忽略，原因写进 `list()` 的 `error`，不影响该插件的其它视图与钩子。
- 只有**已启用、兼容、已注册**的插件视图会出现；顺序为 `priority` 升序，同优先级按注册顺序。
- 视图标识（`data-view`）固定为 `plugin:<pluginId>:<viewId>`。
- `mount` 可以返回 Promise；同步抛错或 Promise 拒绝时，面板显示“插件视图加载失败：…”并弹出 toast，其它视图不受影响。
- 刷新插件（`ND.plugins.load()`）或停用插件后，宿主会移除动态导航与视图并重建；若当前正停在被移除的插件视图上，自动回到“插件”页。

`ND.plugins.views()` 返回扁平数组：

```js
[{
  pluginId: "ai-analysis",
  id: "ai",
  label: "AI 分析",
  mount: function (el, ctx) {},
  onShow: function (ctx) {}   // 未提供时为 null
}]
```

`mount(el, ctx)` / `onShow(ctx)` 的 `ctx`：

| 字段 | 说明 |
|---|---|
| `pluginId` | 当前插件 id |
| `getBook()` | 返回宿主当前书对象（`state.book`），未导入时为 `null` |
| `getSelectedChapter()` | 返回当前选中章节对象，未选中时为 `undefined` |
| `toast(message)` | 复用宿主 toast，2.8 秒后消失 |
| `switchView(name)` | 切换视图；传入 `"reader"`、`"plugins"` 或 `plugin:<id>:<view>` 等 |
| `refresh()` | 重新渲染宿主界面（`renderAll`），不重建插件视图 |
| `storage` | 当前插件的独立存储，见下一节 |

示例：在 `mount` 中读取当前书并写入自己的数据。

```js
mount: function (el, ctx) {
  var book = ctx.getBook();
  var title = book ? book.title : "未导入";
  el.innerHTML = "";
  var heading = document.createElement("h3");
  heading.textContent = "AI 分析";
  var line = document.createElement("p");
  line.textContent = "当前书：" + title;
  el.appendChild(heading);
  el.appendChild(line);

  ctx.storage.set("lastOpenedBook", book ? book.id : null).catch(function (error) {
    ctx.toast(error.message);
  });
}
```

> 插件视图拥有页面 DOM 权限，渲染用户文本时请自行转义或使用 `textContent`。

---

## 6. 插件存储

插件数据存放在 IndexedDB 的 `pluginData` 对象仓库，主键为 `[pluginId, key]`，并带有 `pluginId` 索引。通过 `ND.plugins.storage(自己的 id)` 访问时，不同插件互不可见；同名 key 也不会互相覆盖。

```js
const storage = ND.plugins.storage("ai-analysis");

await storage.set("config", { model: "local", temperature: 0.2 });
const config = await storage.get("config", {});   // 缺失时返回 fallback
const all = await storage.list();                 // { key: value }
await storage.remove("config");
```

| 方法 | 返回 | 说明 |
|---|---|---|
| `get(key, fallback)` | `Promise<any>` | 缺失时解析为 `fallback` |
| `set(key, value)` | `Promise<value>` | 值需可结构化克隆（对象、数组、字符串、数字、布尔、Blob 等） |
| `remove(key)` | `Promise<void>` | 删除单个键 |
| `list()` | `Promise<object>` | 当前插件的全部键值对 |

宿主级 API 等价于：

```js
ND.db.pluginGet(pluginId, key, fallback)
ND.db.pluginSet(pluginId, key, value)
ND.db.pluginDelete(pluginId, key)
ND.db.pluginList(pluginId)
ND.db.pluginClear(pluginId)      // 清理该插件全部数据
```

说明：

- 书架“清空书架”会连同 `pluginData` 一起清空。
- 若页面运行在旧库降级模式（`ND.db.isLegacy() === true`）且尚未完成 v2 升级，`pluginData` 不存在，以上 API 会抛出中文错误（如“插件存储不可用：当前处于旧数据库降级模式…”）。插件应捕获并在视图中提示。
- `storage()` 返回的对象已绑定插件 id，无法改指其它插件；底层 `ND.db.plugin*` 需要显式传入 pluginId，插件应只传自己的 id，不要读取或清理其它插件的数据。

---

## 7. 事件

宿主在状态变化后向 `window` 派发自定义事件，插件可监听并刷新自己的视图。

```js
window.addEventListener("nd:book-changed", function (event) {
  var book = event.detail.book;   // 未导入 / 删除当前书 / 清空书架时为 null
  // 例如重新渲染当前插件视图
});

window.addEventListener("nd:chapter-changed", function (event) {
  var chapter = event.detail.chapter;   // 当前选中章节对象
});
```

| 事件 | `detail` | 触发时机 |
|---|---|---|
| `nd:book-changed` | `{ book }` | 导入、重新切分、从书架打开、恢复会话、删除当前书、清空书架（`book: null`） |
| `nd:chapter-changed` | `{ chapter }` | 选择章节后（目录、清洗预览跳转、上一章/下一章） |

示例：监听书籍变化，更新面板内容。

```js
ND.plugins.register({
  id: "ai-analysis",
  apiVersion: 1,
  ui: {
    views: [{
      id: "ai",
      label: "AI 分析",
      mount: function (el, ctx) {
        function render() {
          var book = ctx.getBook();
          el.textContent = book ? "当前书：" + book.title : "请先导入一本书";
        }
        render();
        window.addEventListener("nd:book-changed", render);
        window.addEventListener("nd:chapter-changed", render);
      },
    }],
  },
});
```

> 视图被刷新重建后，旧 DOM 与监听器可能仍在内存中；在 `mount` 里注册的监听器建议使用具名函数，并在不需要时自行移除。宿主目前不提供 `unmount` 钩子。

---

## 8. 默认变量

| 变量 | 说明 |
|---|---|
| `book` | 书名（去掉 `.txt` 后缀） |
| `bookSafe` | 安全化后的书名，可作目录名 |
| `volume` | 卷原始标题 |
| `volumeNo` | 卷号补零两位；synthetic 卷为 `00` |
| `volumeSafe` | 卷名安全化；synthetic 卷为 `序章` |
| `volumeTitle` | 卷名（优先 `name`，否则原始标题） |
| `chapterNo` | 全书内容编号补零四位；无编号为 `0000` |
| `localNo` | 卷内编号补零四位；无编号为 `0000` |
| `title` | 当前词条标题（已应用清洗与插件规范化） |
| `titleSafe` | 安全化后的标题，可作文件名 |
| `rawTitle` | 原始标题 |
| `type` | 词条类型：`chapter` / `preface` / `volumeNote` / `notice` |
| `date` | 导出日期 `YYYY-MM-DD`（本地时区） |
| `ext` | 章节正文扩展名，固定 `txt` |

---

## 9. 模板语法

```text
{{变量名}}
{{ plugin.clean-annotations.cleanTitle }}
```

- 变量名允许字母、数字、下划线、点、连字符。
- 未知变量渲染为空字符串。
- 默认模板：

```text
volumeFolder: "{{volumeNo}}_{{volumeSafe}}"
chapterFile:  "{{chapterNo}}_{{titleSafe}}.txt"
header:       "{{title}}"
```

默认模板与插件系统引入前完全一致。

### 模板保存位置

`localStorage` 键：`novel-disassembly-templates-v1`。

```js
ND.plugins.templates();      // { volumeFolder, chapterFile, header }
ND.plugins.setTemplates({ header: "{{title}}" });
ND.plugins.defaultTemplates();
```

### 路径安全

渲染结果按 `/`（也接受 `\`）分段，每段：

- 替换 Windows 非法字符 `\ : * ? " < > |` 与控制字符为 `_`；
- 合并连续空白；
- 去掉首尾的点和空白；
- 拒绝空段、`.`、`..`；
- 对 `CON`、`PRN`、`AUX`、`NUL`、`COM1-9`、`LPT1-9` 等保留名加 `_` 前缀；
- 绝对路径、盘符与 `..` 不会逃出导出根目录。

渲染结果为空时回退到默认模板。章节文件名若不以 `.txt` 结尾，导出器会补 `.txt`。卷目录模板使用该卷第一个导出词条的变量；章节模板使用当前词条的变量。

### 内容格式

```text
<header 渲染结果>
<空行>
<正文>
```

正文为空时只写内容头。默认 `header = {{title}}`，因此与旧版 `标题\n\n正文` 完全一致。

单章导出使用同一套规范化与 `chapterFile` / `header` 模板，但只取 `chapterFile` 的最后一段作为下载文件名。

---

## 10. 错误处理

- 插件脚本加载失败：记录到 `list()` 的 `error`，其他插件继续。
- `apiVersion !== 1`：标记不兼容，不加载钩子，插件页显示“不兼容”。
- `normalizeEntry` / `defineVariables` 抛异常：捕获，记录 `[钩子名] 错误信息`，该钩子本次跳过，导出继续。
- 注册 id 重复：清单中重复条目会附加错误信息，先注册者生效。
- 脚本没有调用 `register`：标记“未注册”，开关禁用。

错误不会抛出到导出流程，也不会阻止其他插件。

---

## 11. 安全边界

- 插件是本地 JavaScript，运行在页面权限内，可以读取已导入的文本、修改导出内容、访问页面可访问的浏览器 API。
- 只启用你信任的插件。
- 插件不能联网安装；没有远程市场或自动下载。
- 插件不能绕过浏览器的同源策略、文件系统权限或下载限制。
- 导出路径做了分段安全化，避免 `..`、绝对路径和 Windows 非法字符。
- 插件开关与模板存放在 localStorage；键名分别为 `novel-disassembly-plugin-state-v1` 与 `novel-disassembly-templates-v1`，不涉及本地服务器。旧键 `rp-disassembly-*` 会在启动时复制到新键，旧键保留。
- 插件自有数据由宿主写入 IndexedDB `novel-disassembly` 的 `pluginData` 仓库，主键 `[pluginId, key]`；插件只能通过 `ND.plugins.storage(自己的 id)` 访问。
- 插件视图运行在宿主页面内，可以操作页面 DOM；请使用 `textContent` 或自行转义后再写入 `innerHTML`。

---

## 12. 目录规范

```text
plugins/
├─ README.md
├─ API.md
├─ index.js                  # 生成脚本产物
├─ schema/
│  └─ plugin.schema.json
├─ _template/                # 生成脚本跳过
│  ├─ plugin.json
│  ├─ index.js
│  └─ README.md
├─ clean-annotations/
│  ├─ plugin.json
│  ├─ index.js
│  └─ README.md
└─ ai-analysis/               # 官方：OpenAI 兼容摘要与实体抽取
   ├─ plugin.json
   ├─ index.js
   └─ README.md
```

`plugin.json` 字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 小写字母、数字、连字符，全局唯一 |
| `name` | 是 | 显示名称 |
| `version` | 是 | 插件版本 |
| `apiVersion` | 是 | 必须为 `1` |
| `entry` | 是 | 相对插件目录的入口脚本，如 `index.js` |
| `enabled` | 否 | manifest 默认开关，默认 `false` |
| `priority` | 否 | 默认 `100`，数值小的先执行 |
| `description` | 否 | 插件页说明 |
| `author` | 否 | 仅展示 |
| `hooks` | 否 | 仅展示的钩子名数组 |

生成清单：

```powershell
powershell -File tools/build-plugins.ps1
```

脚本扫描 `plugins/*/plugin.json`，跳过 `_template`，校验必填项、id 格式、入口文件存在性，生成：

```js
window.ND_PLUGIN_INDEX = [
  {
    id: "clean-annotations",
    name: "去除更新标注",
    version: "0.1.0",
    apiVersion: 1,
    entry: "clean-annotations/index.js",
    enabled: false,
    priority: 100,
    description: "..."
  }
];

```

加载器兼容仍写 `window.RP_PLUGIN_INDEX` 的旧清单文件；但生成脚本只写 `window.ND_PLUGIN_INDEX`。

---

## 13. 新增插件

1. 复制 `plugins/_template` 为 `plugins/<你的 id>`。
2. 修改 `plugin.json` 的 `id`、`name`、`version`、`description`。
3. 修改 `index.js`，保证 `register` 的 `id` 与 `plugin.json` 一致。
4. 运行 `powershell -File tools/build-plugins.ps1`。
5. 刷新 index.html，进入“插件”页启用。
6. 导入素材，检查模板预览与实际导出。

---

## 14. 版本兼容

- 当前 API 版本为 `1`。
- 全局入口为 `window.ND`；`window.RP` 是永久兼容别名，旧插件继续工作。
- `apiVersion === 1` 的插件直接加载。
- 其他版本标记为不兼容，不执行钩子。
- 后续新增钩子不会改变现有钩子的签名；已有插件可继续工作。
- 如果必须破坏兼容，会提升 API 版本并在插件页明确提示。

---

## 15. 后续规划

- `beforeExport`：全书级预处理（统一书名、卷名、全局替换）。
- `exporters`：插件注册新的导出格式。
- `importers`：注册新的导入格式。
- `afterImport`：从 ZIP / 文件夹回读后做规范化。
- 视图卸载钩子（`unmount`）与更多固定插槽（阅读侧栏、导出格式区）。
- UI 视图与插件存储已在 API 1 内实现；本地插件服务器仍不在范围内。

---

## 16. 运行时 API 摘要

```js
ND.plugins.register(def)          // 注册插件（可含 ui.views）
ND.plugins.list()                 // [{id,name,version,priority,enabled,error,hooks,viewCount,description,...}]
ND.plugins.views()                // [{pluginId,id,label,mount,onShow}]
ND.plugins.storage(pluginId)      // {get,set,remove,list}，全部返回 Promise
ND.plugins.load()                 // Promise，加载清单与插件脚本
ND.plugins.normalize(entry, ctx)  // 依次执行 normalizeEntry
ND.plugins.variables(entry, ctx)  // 默认变量 + defineVariables
ND.plugins.render(template, vars) // {{var}} 替换
ND.plugins.templates()            // 当前模板
ND.plugins.setTemplates(patch)    // 保存模板
ND.plugins.defaultTemplates()     // 默认模板
ND.plugins.isEnabled(id)
ND.plugins.setEnabled(id, bool)
ND.plugins.safePath(value, fallback)
ND.plugins.status()               // 加载状态、清单路径、错误数
```

# 插件 API

版本：`apiVersion: 1`

本文档描述 Novel-Disassembly 的导出插件接口、词条模型、加载流程、变量、模板与安全边界。插件是普通经典脚本（非 ES module），通过 `window.RP.plugins.register(def)` 注册，兼容 `file://` 双击打开。

---

## 1. 快速示例

```js
(function () {
  "use strict";
  if (!window.RP || !window.RP.plugins) return;

  RP.plugins.register({
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
2. `js/app.js` 初始化时调用 `RP.plugins.load()`。
3. 加载器插入 `plugins/index.js`，读取 `window.RP_PLUGIN_INDEX`。
4. 按 `priority` 升序（同优先级按清单顺序）依次插入插件入口脚本。
5. 插件脚本调用 `RP.plugins.register(def)`。
6. 每次导出时：
   - 构造词条；
   - 按 `priority` 升序执行所有已启用、兼容、已注册插件的 `normalizeEntry`；
   - 计算默认变量；
   - 按同样顺序执行 `defineVariables`；
   - 渲染模板，生成路径、文件名、内容头；
   - 写出 TXT / ZIP / 文件夹 / EPUB。

显式开关（localStorage）优先于 `plugin.json` 的 `enabled`。开关即时生效，不需要重新加载脚本。

`RP.plugins.load()` 返回 Promise；刷新按钮会移除旧脚本、清空注册表并重新加载。

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

## 5. 默认变量

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

## 6. 模板语法

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

`localStorage` 键：`rp-disassembly-templates-v1`。

```js
RP.plugins.templates();      // { volumeFolder, chapterFile, header }
RP.plugins.setTemplates({ header: "{{title}}" });
RP.plugins.defaultTemplates();
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

## 7. 错误处理

- 插件脚本加载失败：记录到 `list()` 的 `error`，其他插件继续。
- `apiVersion !== 1`：标记不兼容，不加载钩子，插件页显示“不兼容”。
- `normalizeEntry` / `defineVariables` 抛异常：捕获，记录 `[钩子名] 错误信息`，该钩子本次跳过，导出继续。
- 注册 id 重复：清单中重复条目会附加错误信息，先注册者生效。
- 脚本没有调用 `register`：标记“未注册”，开关禁用。

错误不会抛出到导出流程，也不会阻止其他插件。

---

## 8. 安全边界

- 插件是本地 JavaScript，运行在页面权限内，可以读取已导入的文本、修改导出内容、访问页面可访问的浏览器 API。
- 只启用你信任的插件。
- 插件不能联网安装；没有远程市场或自动下载。
- 插件不能绕过浏览器的同源策略、文件系统权限或下载限制。
- 导出路径做了分段安全化，避免 `..`、绝对路径和 Windows 非法字符。
- 插件开关与模板存放在 localStorage；不涉及 IndexedDB 或本地服务器。

---

## 9. 目录规范

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
└─ clean-annotations/
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
window.RP_PLUGIN_INDEX = [
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

---

## 10. 新增插件

1. 复制 `plugins/_template` 为 `plugins/<你的 id>`。
2. 修改 `plugin.json` 的 `id`、`name`、`version`、`description`。
3. 修改 `index.js`，保证 `register` 的 `id` 与 `plugin.json` 一致。
4. 运行 `powershell -File tools/build-plugins.ps1`。
5. 刷新 index.html，进入“插件”页启用。
6. 导入素材，检查模板预览与实际导出。

---

## 11. 版本兼容

- 当前 API 版本为 `1`。
- `apiVersion === 1` 的插件直接加载。
- 其他版本标记为不兼容，不执行钩子。
- 后续新增钩子不会改变现有钩子的签名；已有插件可继续工作。
- 如果必须破坏兼容，会提升 API 版本并在插件页明确提示。

---

## 12. 后续规划

- `beforeExport`：全书级预处理（统一书名、卷名、全局替换）。
- `exporters`：插件注册新的导出格式。
- `afterImport`：从 ZIP / 文件夹回读后做规范化。
- IndexedDB 持久化与本地插件服务器由后续任务实现，不属于 API 1。

---

## 13. 运行时 API 摘要

```js
RP.plugins.register(def)          // 注册插件
RP.plugins.list()                 // [{id,name,version,priority,enabled,error,hooks,description,...}]
RP.plugins.load()                 // Promise，加载清单与插件脚本
RP.plugins.normalize(entry, ctx)  // 依次执行 normalizeEntry
RP.plugins.variables(entry, ctx)  // 默认变量 + defineVariables
RP.plugins.render(template, vars) // {{var}} 替换
RP.plugins.templates()            // 当前模板
RP.plugins.setTemplates(patch)    // 保存模板
RP.plugins.defaultTemplates()     // 默认模板
RP.plugins.isEnabled(id)
RP.plugins.setEnabled(id, bool)
RP.plugins.safePath(value, fallback)
RP.plugins.status()               // 加载状态、清单路径、错误数
```

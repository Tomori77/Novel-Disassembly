# Novel-Disassembly · 分卷拆解器

把整本 TXT 小说按 **卷 → 节** 两级结构切分，剔除请假条/通知/感言等无用段落，并导出为 TXT、ZIP、项目目录或 EPUB。导出的 ZIP / 目录可重新导入，精确保留标题、编号与排除状态。导入的书会保存在浏览器 IndexedDB 书架中，刷新后可恢复上次会话。纯前端、无依赖、离线可用；可选插件可规范化导出词条，导出路径与内容头由模板生成。项目目录导出默认写入项目根的 `export/<书名>/`，可通过本地服务自动落盘，`file://` 下则由浏览器目录授权完成。

> 仓库不包含受版权保护的小说正文。`docs/` 存放工程文档，素材请自行放置在本地并被 `.gitignore` 排除；工具本身可处理任意 TXT。

## 文档

- [工程文档索引](docs/README.md)：架构、数据模型、插件系统、导入导出、AI、开发与测试
- [项目状态](docs/status.md)：已实现 / 未实现 / 下一步一页看清
- [插件 SDK](plugins/README.md)：快速上手与目录规范
- [插件化路线](plugins/ARCHITECTURE.md)：核心边界与 v2 规划
- [旧版单文件](legacy/README.md)：仅存档，不维护

## 当前状态

- **可用**：TXT / ZIP / 文件夹导入、卷节拆解、清洗（左右预览 + 拖拽多选 + 批量操作）、TXT/ZIP/EPUB/项目目录导出、manifest 回读、IndexedDB 书架与旧库迁移、插件宿主（v1 钩子 + UI 视图 + 独立存储）。
- **官方插件**：`ai-analysis` 0.2.3 已实现逐章分析、按卷归并、全书大纲与设定集、插件内 JSON/Markdown 导出，默认启用（未配置模型时不发请求）；`clean-annotations` 为示例，默认停用。
- **未实现**：搜索/统计插件、核心 Markdown/JSON/DOCX 导出、EPUB/DOCX/Markdown 导入、插件 `importers`/`exporters`、AI 实体进入核心 JSON/词条体系。

详见 [docs/status.md](docs/status.md)。

## 打开方式

有两种打开方式，功能相同，区别只在“保存到项目目录”卡片的落盘方式：

| 方式 | 打开入口 | 目录导出行为 |
|---|---|---|
| 双击打开 | `index.html`（`file://`） | 首次点击“保存到项目目录”时选择项目根目录（包含 `index.html`），之后默认写入 `<根>/export/<书名>/`；浏览器需支持 File System Access |
| 本地服务 | 双击 `start.bat`，或 `python serve.py --open` | 服务端直接写入项目根的 `export/<书名>/`，无需授权，浏览器无 File System Access 也可用 |

推荐 Windows + Edge / Chrome。本地服务只监听 `127.0.0.1`，不会对局域网开放。没有 Python 或无法运行服务时，仍可双击 `index.html` 使用全部编辑功能与 TXT / ZIP / EPUB 导出。

## 本地服务

`serve.py` 仅使用 Python 3 标准库，无第三方依赖：

```powershell
python serve.py                 # 默认 http://127.0.0.1:8765/
python serve.py --port 8766     # 指定端口
python serve.py --open          # 启动后打开浏览器
```

`start.bat` 会切换到自身目录并运行 `python serve.py --open`；未安装 Python 时给出提示并暂停。端口被占用时会打印明确错误并以非零状态退出。

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/health` | 返回 `{"ok":true,"root":"<项目根>","exportRoot":"<项目根>/export"}` |
| `POST` | `/api/export` | 写入 `<项目根>/export/<book>/<path>`，返回 `{"ok":true,"path":"...","count":N}` |
| `POST` | `/api/ai/proxy` | 仅本机：转发 OpenAI 兼容 GET/POST，供自定义接口无 CORS 时使用 |

`POST /api/ai/proxy` 接收 `{url, method, headers, body}`，只允许 `http/https`、`GET/POST`，仅转发 `Authorization`/`Content-Type`/`Accept` 等必要头，限制请求 5MB、响应 20MB，不记录 Key。AI 插件在 `http://` 模式下直连失败时会自动改走该代理；`file://` 双击模式不经过服务。

`POST /api/export` 的请求体：

```json
{
  "book": "书名",
  "files": [{ "path": "01_卷/0001_章节.txt", "content": "..." }],
  "binary": [{ "path": "书名.epub", "base64": "..." }]
}
```

安全边界：

- 只绑定 `127.0.0.1`，并校验 `Host` 头，不接受局域网访问。
- `book` 与每个 `path` 都按段校验：拒绝空段、`.`、`..`、绝对路径、盘符、反斜杠、控制字符、Windows 非法字符与保留名。
- 写入前解析真实路径，任何越出 `export/` 的目标都会被拒绝；服务端不会写入 `export/` 之外。
- 请求体上限 200MB；错误返回 400 / 413 / 500 + 中文 JSON `{"ok":false,"error":"..."}`，不打印请求体。
- 静态响应带 `Cache-Control: no-cache`，修改脚本后刷新即可加载新版本。

## 使用

双击 `index.html`（推荐 Chrome / Edge）→ 导入 TXT、ZIP 或文件夹；或双击 `start.bat` 通过本地服务打开。

1. **素材与切分**：导入原始 TXT 后自动切分；也可调整卷/章节正则，点“重新切分”。规则保存在浏览器 localStorage。
2. **清洗**：左侧可疑章节列表，点击右侧实时预览正文；支持鼠标拖拽、Ctrl/Cmd 点选、Shift 范围选、全选与批量排除/恢复。从已选行开始拖拽会取消经过的行；普通点击已选行会取消该行选中（预览仍更新），点击未选行只预览、不自动选中。复选框只影响导出，不改原文。
3. **卷目录**：按卷折叠浏览，点击章节进入阅读；灰色表示已排除。
4. **阅读**：查看正文、修改标题、排除/恢复本章、导出单章；左右方向键切换上一章/下一章。
5. **导出**：
   - TXT：单文件，按 `book.chapters` 的阅读顺序输出，保留卷标题和章节名；可选原始编号、全书序号后缀或全书连续重编号
   - ZIP：内含 `<书名>/` 根目录，按卷分文件夹，每章一个 txt，附 `目录.txt`、`剔除清单.txt`、`_manifest.json`
   - 项目目录：写入 `<项目根>/export/<书名>/`，内容与 ZIP 相同，并额外写入 `<书名>.epub`
   - EPUB：单文件电子书，带卷目录
6. **书架**：位于“素材与切分”页下方，列出最近 20 本已保存的书；可打开、删除或清空，并显示存储占用。
7. **插件**：查看已加载插件、启用/停用、编辑导出模板并实时预览第一个内容章节的路径。插件可注册侧栏视图并使用独立存储。默认不启用导出类插件，默认导出结果与旧版一致。
8. **AI 分析**：官方插件 `ai-analysis` 默认启用但空闲。配置 OpenAI 兼容接口（Base URL 只填基础地址，自动补 `/v1`；可“拉取模型”选择模型）后，可勾选大纲/人物/物品/地点/势力/事件/伏笔，手动逐章生成摘要、关键原文与实体，再按卷归并、汇总为全书大纲与设定集；结果按 Tab 浏览，按书保存在本地插件存储，刷新后仍可查看，并可导出 JSON/Markdown（不含 API Key）。未配置时不发请求，TXT / ZIP / EPUB 导出不受影响。

## 持久化与书架

导入成功后，整本书（原文、卷章、标题、排除状态、分类原因等）会写入浏览器 IndexedDB，数据库名 `novel-disassembly`（v2），并按书隔离：

| 对象仓库 | 主键 | 内容 |
|---|---|---|
| `books` | `id` | 书名、文件名、来源（txt/zip/folder）、创建/更新时间、统计、缺失文件数 |
| `sources` | `bookId` | 原文 `rawText` |
| `volumes` | `[bookId, id]` | 卷标题、编号、名称、synthetic、index；索引 `bookId` |
| `chapters` | `[bookId, id]` | 全部章节字段与 `order`；索引 `bookId` |
| `settings` | `key` | `lastBookId`、`lastChapterId`、`lastView`、`lastFilter` |
| `pluginData` | `[pluginId, key]` | 插件独立键值数据；索引 `pluginId` |

复合主键保证不同书的 `C00001` 不会冲突；`saveBook` 在单个事务中先按 `bookId` 删除旧卷章，再批量写入。`pluginData` 是 v2 新增仓库，v1 → v2 升级只新增该 store，不清空已有书籍；清空书架会一并清理插件数据。

自动保存与恢复：

- 导入 TXT / ZIP / 文件夹、重新切分后自动保存，并写入 `lastBookId`、首章 `lastChapterId`、当前视图与目录筛选。
- 修改标题、排除/恢复、清洗页勾选、批量排除/恢复、重新检测后保存；连续操作合并为 400ms 防抖队列，串行执行事务，避免并发事务冲突。
- 选择章节、切换视图、修改目录筛选后防抖写入会话位置。
- 启动时读取 `lastBookId` 并还原书名、原文、卷章、排除状态、当前章节、视图与筛选；**不会重新运行 junk 分类**。若章节已不存在则回到首个内容章节，并提示“已恢复上次会话”。
- 删除当前书或清空书架时，界面回到未导入状态并清除 `lastBookId`。
- 关闭或刷新页面前会尽量冲刷待写队列（`beforeunload`），但不保证最后一次写入一定完成。

书架：

- 每行显示书名、来源、更新时间、卷/节/排除统计，以及“打开”“删除”。删除需确认，删除当前书会清空界面状态。
- 底部显示 `navigator.storage.estimate()` 的占用（MB）与浏览器配额，可“清空书架”（需确认）。
- 存储只属于当前浏览器与当前来源（`file://` 打开时为该文件来源），不跨浏览器、不跨设备，也不会上传。

降级：IndexedDB 不可用或写入失败时，侧栏显示“未持久化”，书架显示“当前环境不支持持久化”，并只提示一次。导入、编辑、导出等原有流程继续可用，但刷新后修改会丢失。

### 从旧版本迁移

- **IndexedDB**：首次用新版打开时，若新库 `novel-disassembly` 的 `books` 为空，会把旧库 `rp-disassembly` 的 `books`、`sources`、`volumes`、`chapters`、`settings` 五个仓库复制到新库，逐仓库校验条数，并在 `settings` 写入 `legacyMigration = { from: "rp-disassembly", at: "<ISO 时间>" }`。迁移成功后新库直接可用；旧库**保留不删**。若新库已有书则跳过，重复启动不会重复迁移。
- **迁移失败**：新库仍为空时关闭新库，本次会话改用旧库连接（`ND.db.isLegacy()` 返回 `true`），下次启动会重试迁移；旧库没有数据或迁移成功时返回 `false`。
- **localStorage**：`js/util.js` 在其它脚本之前同步把 `rp-disassembly-rules-v1`、`rp-disassembly-options-v1`、`rp-disassembly-templates-v1`、`rp-disassembly-plugin-state-v1` 复制到对应的 `novel-disassembly-*` 键；旧键保留，新键已存在时不覆盖。之后只读写新键。
- **命名空间**：全局入口为 `window.ND`；`window.RP = window.ND` 作为永久兼容别名保留，旧插件里的 `RP.plugins.register` 仍可工作。
- **manifest**：新导出写 `novel-disassembly/1`；导入同时接受 `novel-disassembly/1` 与旧的 `rp-disassembly/1`，旧 ZIP / 目录仍可回读。

## 导入

顶栏有两个入口：

- **导入 TXT / ZIP**：选 `.txt` 走原有正则切分流程；选 `.zip` 读取压缩包并回读。
- **导入文件夹**：选择导出的书目录（或任意整理好的卷/章目录），读取其中全部 `.txt` 与 `_manifest.json`。

回读规则：

- 找到 `_manifest.json` 时按 manifest 精确还原卷、章节标题、原始标题、类型、全书/卷内编号、标签编号、排除状态与原因；文件缺失会跳过并在提示中报告数量。
- 没有 manifest 时按目录结构推断：去掉所有文件的共同顶层目录作为书名；一级子目录为卷（`01_魔性不改` → `第1卷 魔性不改`，`00_序章` 视为序章卷）；根目录下的 `.txt` 归入“序章”卷；章节标题优先取正文第一行（以 `第…节/章/回` 开头时），否则用去掉 `0001_` 前缀的文件名；编号按顺序重排，不做自动排除。
- TXT 优先按 UTF-8 解码，出现大量替换字符时回退 GB18030。
- 从导出目录还原后仍可修改标题、排除章节、重新导出；“重新切分”会基于拼接文本执行，可能改变结构，执行前会二次确认。

## 导出目录结构

ZIP 解压后得到与书名同名的文件夹；项目目录导出也使用同样的内部结构：

```
export/
  蛊/
    目录.txt
    剔除清单.txt
    _manifest.json
    蛊.epub
    01_魔性不改/
      0001_第一节：纵身亡魔心仍不悔.txt
      0002_第二节：逆光阴五百年觉悟.txt
      ...
    02_ ...
```

ZIP 文件名仍为 `<书名>_分卷.zip`。项目目录导出写入项目根的 `export/<书名>/`，内容与 ZIP 相同，并额外写入 `<书名>.epub`；EPUB 本身仍是单文件，不参与 manifest 的章节路径。

首次在 `file://` 下使用项目目录导出时，浏览器会要求选择项目根目录（包含 `index.html`）。授权句柄保存在 IndexedDB `settings` 的 `exportRootHandle` 中，之后默认写入 `<根>/export/<书名>/`。权限可能被浏览器或系统回收：此时再次点击保存会重新弹出目录选择器。若浏览器不支持 File System Access、或目录写入被拒绝，界面会提示改用 `start.bat` 或 ZIP，不会静默失败。

注意：`export/` 是服务端与浏览器的共同写入目标，但两边写入的范围都限定在该目录内。服务端只允许 `127.0.0.1` 访问，路径在写入前逐段校验并解析真实路径，拒绝 `..`、绝对路径、盘符与符号链接越界。

### _manifest.json

```json
{
  "format": "novel-disassembly/1",
  "book": "蛊",
  "exportedAt": "2026-10-17T12:00:00.000Z",
  "options": {
    "includeExcluded": true,
    "includeNotes": true,
    "useEditedTitles": true,
    "cleanWatermark": true,
    "cleanTrailingNotes": true
  },
  "plugins": [],
  "templates": {
    "volumeFolder": "{{volumeNo}}_{{volumeSafe}}",
    "chapterFile": "{{chapterNo}}_{{titleSafe}}.txt",
    "header": "{{title}}"
  },
  "volumes": [
    {
      "title": "第一卷 ：魔性不改",
      "number": 1,
      "name": "魔性不改",
      "synthetic": false,
      "chapters": [
        {
          "file": "01_魔性不改/0001_第一节：纵身亡魔心仍不悔.txt",
          "title": "第一节：纵身亡魔心仍不悔",
          "rawTitle": "第一节：纵身亡魔心仍不悔",
          "type": "chapter",
          "globalIndex": 1,
          "localIndex": 1,
          "labelNumber": 1,
          "labelUnit": "节",
          "excluded": false,
          "reasons": [],
          "junkType": "normal",
          "junkScore": 0
        }
      ]
    }
  ]
}
```

- 只记录实际写出的章节。未勾选“包含已排除章节”时，被排除的章节不写文件、也不进 manifest，但仍会列在 `剔除清单.txt`；因此默认导出回读后不再有排除项。需要完整回读时请先勾选“包含已排除章节”。
- 章节文件内容格式为 `内容头\n\n正文`，默认内容头就是 `{{title}}`，因此与旧版 `标题\n\n正文` 相同；回读时首行若等于 manifest 标题会被去掉。自定义内容头后，回读仍以 manifest 标题为准。
- 导出的正文已按清洗选项处理（水印、章末附言），回读得到的是清洗后的文本，不等同原始素材。
- `exportedAt` 每次导出都会变化，其余字段在结构不变时保持稳定。
- 新版写出 `format: "novel-disassembly/1"`；导入兼容旧的 `format: "rp-disassembly/1"`，旧 ZIP / 目录无需转换。

## 识别规则

- 卷：`第 X 卷` / `卷 X` / `Volume X`，要求独占一行、长度 ≤ 48、不以 `。！？` 结尾
- 节：`第 X 节/章/回` / `Chapter X`，长度 ≤ 60
- 通知块：独立成段（前后空行）的 `请假`、`今天无更`、`更新在 X 点`、`通知：`、`单章：`、`感言`、`求月票` 等
- 自动排除：通知块 + 标题命中通知类词汇 + 正文极短的章节；疑似项需人工确认
- 重复检测：正文前 120 字 + 长度相同的章节标记为疑似

## 导出清洗选项

- 清除盗版/网址水印行（`更新快`、`笔趣阁`、`www.`、`http` 等短行）
- 清除章末作者附言（后半段出现的 `ps：`、`通知：`、`请假`、`求月票` 等）

两项默认开启，导出内容为副本，不影响原文。

## TXT 章节编号

导出页的“TXT 章节编号”只影响 TXT，ZIP / EPUB / 项目目录 / manifest 保持原有分组与内容。默认“原始编号”与旧版输出一致（仅按阅读顺序修正章节先后）。

| 模式 | 输出 |
|---|---|
| 原始编号（默认） | 标题保持原样，如 `第一节：纵身亡魔心仍不悔` |
| 保留原名 + 全书序号 | 标题末尾追加全书序号，如 `第一节：纵身亡魔心仍不悔（全书第 1 节）`；通知/卷首语无全书编号时不追加 |
| 全书连续重编号 | 章节输出 `第 N 章 <去掉原编号后的标题>`，如 `第 1 章 纵身亡魔心仍不悔`；序章/前言为 `第 N 章 序章 / 前言`，通知输出 `通知：…`，卷首语输出 `卷首语`，卷标题不变 |

TXT 严格按 `book.chapters` 顺序遍历，按当前“包含已排除章节 / 包含卷首语、前言”选项过滤；`volumeId` 变化时插入该卷标题（synthetic 卷不插标题）。因此即使卷数组顺序异常，TXT 仍按全书阅读顺序输出。编号模式保存在导出选项的 localStorage 键中，顶部“导出 TXT”与导出页 TXT 卡片使用同一逻辑。`global-prefix` 重新导入时章节标题仍以 `第X节` 开头，`global-renumber` 以 `第N章` 开头，可正常重新切分。

## 插件与导出模板

插件可以规范化“导出词条”（标题、正文、编号、类型），并提供专用导出变量。TXT / ZIP / 文件夹 / EPUB 与单章导出共用同一套规范化与模板。插件开关和导出模板保存在 localStorage；插件还可注册侧栏视图并使用独立存储（IndexedDB `pluginData`，按 `pluginId` 隔离）。不需要本地服务器。

当前官方插件：

| 插件 | 默认 | 说明 |
|---|---|---|
| `clean-annotations` | 停用 | 去除标题末尾的更新/求票括号标注，提供 `cleanTitle` 变量 |
| `ai-analysis` | 启用 | OpenAI 兼容直连的逐章摘要/关键原文、卷归并、全书大纲与人物/物品/地点/势力/事件/伏笔设定集；插件内 JSON/Markdown 导出，结果按书持久化 |

`ai-analysis` 的 Key 以明文保存在当前浏览器的插件存储中，不会进入导出文件或仓库；请求直接从浏览器发往所配置的服务商。详见 [`plugins/ai-analysis/README.md`](plugins/ai-analysis/README.md)。

哪些功能适合迁出本体、核心边界与 v2 词条/变量规划，见 `plugins/ARCHITECTURE.md`。

默认模板与旧版导出一致：

```text
volumeFolder: "{{volumeNo}}_{{volumeSafe}}"
chapterFile:  "{{chapterNo}}_{{titleSafe}}.txt"
header:       "{{title}}"
```

默认变量：`book`、`bookSafe`、`volume`、`volumeNo`、`volumeSafe`、`volumeTitle`、`chapterNo`、`localNo`、`title`、`titleSafe`、`rawTitle`、`type`、`date`、`ext`。插件变量以 `{{plugin.<id>.<name>}}` 暴露，无冲突时也可直接用 `{{name}}`。变量与钩子细节见 `plugins/API.md`。

### 目录与生成清单

```text
plugins/
├─ README.md
├─ API.md
├─ ARCHITECTURE.md            # 插件化拆分路线与 v2 设计
├─ index.js                  # 生成脚本产物
├─ schema/plugin.schema.json
├─ _template/                # 复制它开始写插件
├─ clean-annotations/        # 示例：去除标题末尾更新标注，默认停用
└─ ai-analysis/              # 官方：逐章摘要+卷归并+全书大纲/设定集，默认启用
tools/build-plugins.ps1      # 扫描 plugins/*/plugin.json 生成 index.js
```

新增或修改插件后，在项目根目录运行：

```powershell
powershell -File tools/build-plugins.ps1
```

然后刷新页面，在“插件”页启用。插件只能从本地文件夹安装，不能联网获取；插件是本地 JavaScript，拥有页面权限，只启用可信代码。`apiVersion` 不是 1 的插件会显示不兼容且不执行钩子；钩子异常会被记录，不中断导出。

模板展开后按 `/` 分段安全化：替换 Windows 非法字符、禁止 `..` 与绝对路径、处理保留名。章节文件名缺少 `.txt` 时会自动补上。ZIP / 文件夹导出仍保留同名冲突的 `_2` 后缀逻辑。

### manifest 新增字段

`_manifest.json` 新增：

```json
{
  "plugins": [{ "id": "clean-annotations", "version": "0.1.0" }],
  "templates": {
    "volumeFolder": "{{volumeNo}}_{{volumeSafe}}",
    "chapterFile": "{{chapterNo}}_{{titleSafe}}.txt",
    "header": "{{title}}"
  }
}
```

`plugins` 只记录已启用、兼容且成功注册的插件；未启用时为空数组。`js/importer.js` 会忽略这两个字段，旧导出目录仍可正常回读。

## 目录结构

```
index.html        入口
styles.css        样式
serve.py          本地静态服务 + /api/health、/api/export（Python 3 标准库）
start.bat         Windows 快捷启动（python serve.py --open）
js/util.js        文本规范化、中文数字、文件名等工具
js/db.js          IndexedDB 持久化（书、原文、卷、章、设置）与存储估算
js/parser.js      卷/节/通知块切分与导出正文清洗
js/plugins.js     插件注册、加载、词条规范化、变量与模板
js/junk.js        无用章节分类与重复检测
js/zip.js         纯前端 ZIP 写入器（store）与读取器（store / deflate）
js/importer.js    ZIP / 文件夹回读、manifest 还原与目录推断
js/exporter.js    TXT / ZIP / 文件夹 / EPUB 导出与 manifest 生成
js/export-target.js  导出目标探测：服务端写入、File System Access 或降级提示
js/app.js         状态、界面与事件
plugins/          插件目录：API 文档、schema、模板、示例与生成清单
tools/            build-plugins.ps1 等本地脚本
docs/             工程文档：架构、数据模型、插件、导入导出、开发；本地素材默认不纳入仓库
legacy/           旧版单文件（历史存档，不维护）
.vscode/          CSS 自定义数据，消除 backdrop-filter 误报
export/           默认项目目录导出目标（不存在时按需创建）
```

## 已知限制

- 24MB 级 TXT 会整本读入内存，处理与导出需要几秒；EPUB 约 2400 章时包体较大
- ZIP 读取不支持 ZIP64、加密与分卷；deflate 解压依赖浏览器 `DecompressionStream`，不支持时会提示改用其他浏览器
- 项目目录导出在 `file://` 下依赖 `window.showDirectoryPicker`（Chromium 系浏览器）。首次需选择项目根目录，句柄保存在 IndexedDB；权限被回收后需重新选择。浏览器不支持或拒绝写入时会提示改用 `start.bat` 或 ZIP；无头测试无法验证选择器的交互
- 本地服务默认端口 8765，只监听 `127.0.0.1`；若要换端口，用 `python serve.py --port <端口>`，`start.bat` 默认不带参数
- 没有 manifest 的目录只能推断结构：通知/卷首语会被当作普通章节，排除状态、原始标题与类型无法恢复；章节按文件名数字前缀排序，导出时编号为 `0000` 的通知可能排到卷首
- 持久化仅限当前浏览器与当前来源；清除站点数据、使用隐私模式或更换浏览器/设备后书架为空
- 大型 TXT 首次写入 IndexedDB 需要时间，并受浏览器配额限制；写入失败时自动降级为内存模式
- 关闭/刷新时 `beforeunload` 的冲刷是尽力而为，最后一次操作可能来不及落盘
- 书架“删除”和“清空”不可撤销；书架只显示最近 20 本，更早的书仍保留在数据库中
- 通知识别依赖“前后空行”；夹在正文段落中间的作者附言由导出清洗处理，不单独成章
- 正则按行匹配，不解析 HTML/EPUB 源文件
- 插件通过动态 `<script>` 从本地 `plugins/` 加载，需与 index.html 同目录部署；不能联网安装或自动更新
- 修改 `plugin.json` 后必须重新运行 `tools/build-plugins.ps1`；只改 `index.js` 也需要刷新页面重新执行脚本。插件开关与模板存在 localStorage，刷新后保留
- 插件运行在页面权限内，可读取导入文本并修改导出内容；钩子异常只记录到插件页，不会中断导出
- 插件视图目前没有卸载钩子；刷新/停用插件时宿主会移除并重建视图 DOM，插件自行注册的事件监听需自行清理
- 旧库降级模式（`ND.db.isLegacy()`）下 `pluginData` 可能不存在，插件存储 API 会抛出中文错误，需刷新页面完成 v2 升级
- 模板是纯字符串替换，无表达式/条件语法；插件变量在卷目录模板中使用该卷第一个导出词条的值
- `beforeExport`、`exporters`、`afterImport` 为预留钩子，尚未实现；插件仍只从本地 `plugins/` 加载
- 搜索/统计插件尚未实现，当前没有全文检索或统计面板
- Markdown/JSON/DOCX 导出、EPUB/DOCX/Markdown 导入尚未实现
- AI 插件逐章单次最多 50 章、单章最多发送 8000 字，卷归并约 12000 字、全书汇总约 16000 字输入上限；顺序执行，不支持并发、自动重试、断点续跑、费用上限；失败卷会跳过，全书结果可能不完整；结果可导出插件内 JSON/Markdown，但暂不进入核心 JSON/词条；Key 明文存本地 IndexedDB；部分服务商可能被 CORS 拦截
- 清洗页拖拽到列表边缘不会自动滚动，触摸屏拖选未适配

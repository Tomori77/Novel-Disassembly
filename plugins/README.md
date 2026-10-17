# 插件目录

RP Disassembly 的导出插件放在这里。插件可以规范化导出词条（标题、正文、编号、类型）、提供专用变量，并配合模板改变导出路径、文件名与内容头。

- 完整接口：`plugins/API.md`
- 插件化拆分路线与词条/v2 设计：`plugins/ARCHITECTURE.md`
- 插件页：index.html → 侧栏“插件”
- 默认不启用任何插件，默认导出结果与以前一致
- 插件是本地经典脚本，兼容 `file://` 双击打开；无依赖、无构建、不能联网安装

## 目录

```text
plugins/
├─ README.md
├─ API.md
├─ ARCHITECTURE.md           # 哪些能力应插件化、核心边界、v2 词条与变量
├─ index.js                  # 由生成脚本创建，勿手工修改
├─ schema/plugin.schema.json
├─ _template/                # 复制这个目录开始写插件（生成脚本会跳过）
└─ clean-annotations/        # 示例：去除标题末尾的更新标注，默认停用
```

## 快速上手

1. 复制 `_template` 为 `plugins/<你的 id>`。
2. 修改 `plugin.json`：

   ```json
   {
     "id": "my-plugin",
     "name": "我的插件",
     "version": "0.1.0",
     "apiVersion": 1,
     "entry": "index.js",
     "enabled": false,
     "priority": 100,
     "description": "说明",
     "hooks": ["normalizeEntry"]
   }
   ```

3. 修改 `index.js`，注册与 `plugin.json` 相同的 id：

   ```js
   (function () {
     "use strict";
     if (!window.RP || !window.RP.plugins) return;
     RP.plugins.register({
       id: "my-plugin",
       apiVersion: 1,
       hooks: {
         normalizeEntry: function (entry) {
           entry.chapter.title = entry.chapter.title.trim();
           return entry;
         },
       },
     });
   })();
   ```

4. 在项目根目录生成清单：

   ```powershell
   powershell -File tools/build-plugins.ps1
   ```

5. 刷新 index.html，进入“插件”，打开“启用”。

## 模板

默认模板（与旧版导出一致）：

```text
volumeFolder: "{{volumeNo}}_{{volumeSafe}}"
chapterFile:  "{{chapterNo}}_{{titleSafe}}.txt"
header:       "{{title}}"
```

插件变量在模板中用 `{{plugin.<id>.<name>}}`，无冲突时也可用 `{{name}}`。模板保存在 localStorage，插件页可保存 / 恢复默认并实时预览第一个内容章节的路径。

## 注意

- 修改 `plugin.json` 或新增插件后必须重新运行生成脚本并刷新页面。
- 插件开关保存在 localStorage，优先于 `plugin.json` 的 `enabled`。
- 插件拥有页面权限，只启用你信任的代码。
- 当前 API 版本为 1；`apiVersion` 不是 1 的插件会显示“不兼容”且不会执行钩子。
- `beforeExport`、`exporters`、`afterImport` 为预留钩子，尚未实现。

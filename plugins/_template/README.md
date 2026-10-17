# 插件模板

复制整个 `_template` 目录为新目录（目录名建议与插件 id 一致），然后：

1. 修改 `plugin.json`：至少改 `id`、`name`、`version`、`description`；`id` 只能使用小写字母、数字和连字符。
2. 修改 `index.js`：`ND.plugins.register({ id: "..." })` 中的 id 必须与 `plugin.json` 一致。
3. 在项目根目录运行：

   ```powershell
   powershell -File tools/build-plugins.ps1
   ```

4. 刷新 index.html，进入“插件”页启用。

`_template` 本身不会被生成脚本收录。

钩子签名、变量与模板语法见 `plugins/API.md`。

# 开发与测试

## 1. 环境

- Chrome / Edge（Chromium，支持 File System Access 与 `DecompressionStream`）
- Python 3（仅本地服务与部分测试）
- Node.js 18+（语法检查与自动化测试，可选）

无构建工具、无第三方前端依赖。

## 2. 运行

```text
双击 index.html                  # file:// 模式
双击 start.bat                   # 本地服务模式（python serve.py --open）
python serve.py --port 8765      # 手动指定端口
```

服务只监听 `127.0.0.1`，导出写入 `export/<书名>/`。

## 3. 目录

```text
index.html / styles.css
serve.py / start.bat
js/                     核心脚本（经典 script，按顺序加载）
plugins/                插件 SDK、清单、模板、示例
tools/build-plugins.ps1 生成 plugins/index.js
legacy/                 旧版单文件（仅存档）
docs/                   工程文档；本地素材默认不纳管
```

## 4. 插件

新增插件：

1. 复制 `plugins/_template` 为 `plugins/<id>`
2. 修改 `plugin.json`（id/name/version/apiVersion/entry/priority）
3. 编写 `index.js`，调用 `ND.plugins.register`
4. 运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-plugins.ps1
```

5. 刷新页面 → “插件”页启用/配置

## 5. 测试

### 语法

```powershell
Get-ChildItem js,plugins -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
```

### 导出回归（golden）

每次改核心导出/插件管线，至少验证：

- 未启用插件时 TXT/ZIP/EPUB 与基线一致
- `_manifest.json` 除 `format` 从 `rp-disassembly/1` 变为 `novel-disassembly/1` 外字段一致
- 默认选项下章节文件数量/路径一致
- 《蛊》样例：6 卷 / 2364 章节 / 19 条排除（默认导出 2367 个章节文件）

当前为手工/临时脚本对比，尚未固化为 `tests/golden`（待办）。

### 回读闭环

- ZIP 导出 → 读回 → 卷/章/标题/排除状态一致
- 文件夹导出 → 文件夹导入 → 一致
- 无 manifest 目录 → 结构推断可用

### 迁移与兼容

- 用旧库名 `rp-disassembly` 预置书与 settings，加载新版 `js/db.js`，确认新库复制成功、条数一致、旧库仍在、`ND.db.isLegacy() === false`
- 重复执行 `open()`，确认幂等（不重复迁移、不重复书）
- 预置四个 `rp-disassembly-*` localStorage 键，加载 `js/util.js`，确认新键已复制且旧键保留
- 用 `rp-disassembly/1` manifest 构造 entries，确认 `ND.importFromEntries` 可导入
- 加载只调用 `RP.plugins.register` 的旧插件，确认注册与钩子生效；新导出 manifest 的 `format` 为 `novel-disassembly/1`

### 浏览器与交互

- Edge 无头 + 独立 `--user-data-dir` 加载 `index.html`，确认无脚本异常、导航/插件/书架存在
- 需要等待异步（IndexedDB、fetch）时用 CDP，而不是 `--dump-dom` 立即读取
- 清洗页：导入小样本 → 点击行右侧预览 → 拖拽/Ctrl/Shift 多选 → 批量排除/恢复
- 插件视图：临时插件注册 `ui.views`，确认侧栏入口、mount/onShow、存储持久化、停用后回退
- AI 插件：用 `window.fetch` mock 返回固定 JSON，不真实联网；验证配置保存、单章分析、结果持久化、401/CORS 错误提示
- 服务模式：`python serve.py --port 8766` → `/api/health`、`/api/export`、路径穿越 400

### 进程回收（必须）

- 启动服务/无头浏览器必须记录 PID，测试结束用 `taskkill /PID <pid> /T /F`
- 检查端口是否释放、临时 profile 是否删除、无孤儿 `python serve.py` / `msedge.exe --headless`
- 失败时也要在 `finally` 中清理

## 6. 约定

- 经典 `<script>`，不要改成 ES module（`file://` 下会被 CORS 拦截）
- 新代码使用 `window.ND` / `ND.*`；`window.RP = window.ND` 是永久兼容别名，不要删除
- 不引入第三方库；ZIP/DOCX/EPUB 均用内置实现
- 路径必须经过 `safePath`/服务端校验；不写出 `export/` 或授权目录
- 不提交密码、密钥、代理 token、受版权保护的小说正文
- 默认导出行为不变；新增能力走插件或明确的选项
- 文档与代码同一次提交更新

## 7. VSCode

`styles.css` 使用 `backdrop-filter`，部分 VSCode 版本的 CSS 数据会误报。项目已提供：

- `.vscode/css-custom-data.json`：声明 `backdrop-filter` 与 `-webkit-backdrop-filter`
- `.vscode/settings.json`：`css.customData` 指向该文件

若仍误报，可在工作区设置 `"css.lint.unknownProperties": "ignore"`（会同时忽略其它未知属性，慎用）。

## 8. 提交检查清单

- [ ] `node --check` 全部通过
- [ ] 默认导出无差异
- [ ] 插件清单已重新生成
- [ ] 无密钥/素材进入提交
- [ ] 文档已更新
- [ ] 无残留进程/端口

## 9. 相关

- [架构](architecture.md)
- [数据模型](data-model.md)
- [插件系统](plugin-system.md)
- [插件 SDK](../plugins/README.md)

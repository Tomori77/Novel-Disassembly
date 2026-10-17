# 项目文档索引

Novel-Disassembly 是纯前端的“卷 → 节”拆解器，可选插件扩展导出/导入/分析能力。本目录是工程文档；面向使用者的说明在根目录 [`README.md`](../README.md)，插件 SDK 在 [`plugins/`](../plugins/)。

## 建议阅读顺序

1. [架构总览](architecture.md) — 模块、数据流、核心边界
2. [数据模型](data-model.md) — 词条、编号、变量、manifest
3. [插件系统](plugin-system.md) — v1 现状与 v2 设计
4. 格式：[导出](export-formats.md) / [导入](import-formats.md)
5. 内置分析能力：[搜索与统计](search-stats.md) / [AI 分析](ai-analysis.md)
6. [开发与测试](development.md)

## 文档地图

| 文档 | 内容 | 状态 |
|---|---|---|
| [architecture.md](architecture.md) | 运行时、模块划分、数据流、I/O、安全边界 | 已实现 + 设计 |
| [data-model.md](data-model.md) | Book/Volume/Chapter/Entity、编号、变量、manifest | 已实现 + v2 设计 |
| [plugin-system.md](plugin-system.md) | 插件加载、v1 钩子、v2 能力、UI 插槽、存储 | v1 已实现 / v2 设计 |
| [export-formats.md](export-formats.md) | TXT/ZIP/EPUB 现状；Markdown/JSON/DOCX 设计 | 部分实现 |
| [import-formats.md](import-formats.md) | TXT/ZIP/文件夹现状；EPUB/DOCX/MD 设计 | 部分实现 |
| [search-stats.md](search-stats.md) | 全文/正则搜索、卷统计、阅读时长 | 设计 |
| [ai-analysis.md](ai-analysis.md) | 模型配置、摘要、人物/事件/伏笔抽取 | 设计 |
| [development.md](development.md) | 运行、构建插件、测试、仓库约定 | 已实现 |
| [`plugins/API.md`](../plugins/API.md) | 当前插件 API 完整参考 | v1 已实现 |
| [`plugins/ARCHITECTURE.md`](../plugins/ARCHITECTURE.md) | 哪些功能适合插件化、迁移路线 | 设计 |
| [`legacy/README.md`](../legacy/README.md) | 旧版单文件说明与差异 | 归档 |

状态标记：**已实现** 可直接使用；**设计** 已定方案待开发；**部分实现** 核心能力已有，扩展格式/插件待做。

## 本地素材

`docs/` 下可能放有本地 TXT/EPUB 素材，默认被 `.gitignore` 排除，**不进入仓库**。仓库只保留本目录的说明文档。请使用你有权使用的文本测试。

## 维护约定

- 文档与代码同一次提交更新；新增能力先写设计，再改代码。
- 所有路径、变量名、manifest 字段以 `data-model.md` 和 `plugins/API.md` 为准。
- 不把密码、密钥、代理 token、受版权保护的小说正文写入文档或提交。

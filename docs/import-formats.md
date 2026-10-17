# 导入格式

## 1. 当前支持（已实现）

### TXT

- 读取为 ArrayBuffer，先按 UTF-8 解码；替换字符比例过高时回退 GB18030
- 规范化 BOM、CRLF/CR
- 用卷/节正则切分；独立通知块单独识别
- 成功后自动分类（通知/重复/短章）并写入 IndexedDB

### ZIP

- `ND.readZip` 解析中央目录（支持 store 与 deflate）
- 有 `_manifest.json`：按 manifest 精确还原卷、标题、编号、类型、排除状态
- 无 manifest：按目录结构推断（共同顶层目录为书名、一级子目录为卷、`NN_名称` 转卷号、文件名前缀排序）
- 缺失文件跳过并提示数量

### 文件夹

- `<input webkitdirectory>` 读取全部 `.txt` 与 `_manifest.json`
- 与 ZIP 共用 `importFromEntries`

### 导出的整本 TXT

- 走普通 TXT 流程重新切分；卷/节结构可还原，排除状态与插件信息丢失

## 2. 计划中的插件导入（`import-formats`）

### EPUB

1. `ND.readZip` 读取
2. 解析 `META-INF/container.xml` → OPF 路径
3. 解析 OPF：metadata（title）、manifest、spine 顺序
4. 逐章读取 XHTML，剥离 `script/style`，提取标题与段落
5. 按标题层级映射卷/章；无法识别时回退现有卷/节正则
6. 忽略封面、版权页、目录页（可配置）

### DOCX

1. `ND.readZip` 读取
2. 解析 `word/document.xml`
3. 遍历 `w:p`：读取 `w:pStyle`（`Heading1`/`Heading2`/`Title`）与 `w:t` 文本
4. 处理 `w:br`（换行）、`w:tab`（制表符）
5. 按标题层级映射；表格、图片、文本框忽略
6. 回退：无标题样式时按现有正则切分

### Markdown

1. 读取文本（UTF-8，必要时 GB18030）
2. 跳过 YAML front matter（`---` 开头块）
3. 识别 ATX 标题：`#` 卷、`##` 章；`###` 及以下并入正文
4. 代码块（```）内的 `#` 不当作标题
5. 回退：无 `#`/`##` 时按现有正则切分

## 3. 标题层级映射

| 文档结构 | 映射 |
|---|---|
| H1 + H2 | H1 卷，H2 章 |
| 只有 H2 | 合成“序章”卷，H2 为章 |
| 只有 H1 | H1 作为章，放入合成卷（或按用户选择 H1=卷、内容为一章） |
| 无标题 | 回退现有卷/节正则；仍无结果则整本一章 |

规则：

- 标题为空时用“第 N 节”兜底
- 卷号缺失时按出现顺序编号
- 保留原始标题；导出时使用原始编号，不改写

## 4. 导入后处理

- 统一进入 `splitBook` 产出的词条结构（v2 后为 entries）
- 自动跑分类（通知/重复/短章），可在清洗页调整
- 保存到 IndexedDB 书架；`source` 记为 `epub` / `docx` / `markdown`
- 失败时不写入半成品；错误以中文提示

## 5. 限制

- 不支持加密/DRM 的 EPUB、DOCX
- 不解析图片、表格、脚注、批注
- DOCX 只读取正文，页眉页脚/文本框可能丢失
- Markdown 只识别 ATX 标题，Setext（`===`/`---`）暂不支持
- 大文件（>50MB）解析可能明显变慢

## 6. 验收

- EPUB（标准 EPUB3）导入后卷/章数与目录一致
- DOCX（Heading 1/2）导入后层级正确，正文无样式残留
- Markdown（#/##）导入后卷/章正确，代码块内标题不被误识别
- 三者导入后都能正常清洗、导出 TXT/ZIP/EPUB/Markdown/JSON/DOCX
- 导入失败不产生半本书

## 7. 状态

| 格式 | 状态 |
|---|---|
| TXT / 导出的 ZIP / 文件夹 | 已实现 |
| EPUB / DOCX / Markdown | 设计完成，待实现（官方插件） |

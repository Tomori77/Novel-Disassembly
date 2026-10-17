# clean-annotations · 去除更新标注

示例插件，默认**停用**，不会改变原有导出结果。

## 做什么

- 去掉章节标题末尾的更新 / 求票类括号标注：
  - `（为盟主加更）`
  - `（庆祝 100 月票加更）`
  - `（3月月票加更）`
  - `（求月票）`
  - `（感谢打赏）`
- 提供变量 `cleanTitle`，可用于模板或后续插件。

只修改导出词条的标题，不改原文，也不影响清洗页的排除逻辑。

## 启用

1. 打开 index.html → 侧栏“插件”。
2. 找到“去除更新标注”，打开“启用”。
3. 导出的章节标题、文件名与内容头会使用去掉标注后的标题。

开关保存在 localStorage；manifest 的 `plugins` 字段会记录已启用插件。

## 示例

```js
ND.plugins.register({
  id: "clean-annotations",
  apiVersion: 1,
  hooks: {
    normalizeEntry: function (entry) {
      entry.chapter.title = stripAnnotations(entry.chapter.title);
      return entry;
    },
    defineVariables: function (entry) {
      return { cleanTitle: entry.chapter.title };
    },
  },
});
```

模板中可以使用：

```text
{{plugin.clean-annotations.cleanTitle}}
{{cleanTitle}}
```

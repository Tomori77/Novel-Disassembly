(function () {
  "use strict";

  if (!window.ND || !window.ND.plugins) return;

  ND.plugins.register({
    id: "my-plugin",
    name: "我的插件",
    version: "0.1.0",
    apiVersion: 1,
    priority: 100,
    description: "最小示例：注册一个空的 normalizeEntry。",
    hooks: {
      normalizeEntry: function (entry) {
        // 在这里修改 entry，例如：
        // entry.chapter.title = entry.chapter.title.replace(/旧/g, "新");
        return entry;
      },
    },
  });
})();

(function () {
  "use strict";

  if (!window.RP || !window.RP.plugins) return;

  // 匹配标题末尾的更新/求票类括号标注，例如：
  // （为盟主加更）（庆祝100月票加更）（3月月票加更）（求月票）（感谢打赏）
  const ANNOTATION =
    /[（(][^（）()]{0,40}?(?:加更|月票|推荐票|打赏|求票|感谢|庆祝)[^（）()]{0,40}?[）)]\s*$/;

  function stripAnnotations(title) {
    let value = String(title == null ? "" : title);
    while (ANNOTATION.test(value)) {
      value = value.replace(ANNOTATION, "").trim();
    }
    return value || String(title == null ? "" : title);
  }

  RP.plugins.register({
    id: "clean-annotations",
    name: "去除更新标注",
    version: "0.1.0",
    apiVersion: 1,
    priority: 100,
    description: "去掉标题末尾的（为…加更）、（庆祝…加更）、（N月月票…）等括号标注，并提供 cleanTitle 变量。",
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
})();

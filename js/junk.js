(function () {
  "use strict";

  const ND = window.ND;

  const JUNK_EXACT =
    /^(?:请假|请假条|请假一天|请假两天|请假一周|请假几天|今天无更|今日无更|明天无更|今天不更|断更|停更|暂停更新|恢复更新|更新说明|更新公告|加更说明|求票|求月票|求推荐票|求订阅|求收藏|感谢|鸣谢|公告|通知|说明|解释|声明|单章|新书预告|上架感言|完本感言|卷末感言|作者的话|测试|防盗|章节错误|更正)$/;

  const JUNK_LEAD =
    /^(?:请假|求票|求月票|求推荐票|求订阅|公告|通知|单章|说明|解释|声明|断更|停更|上架感言|完本感言|卷末感言|新书预告)/;

  const STRONG_BODY = /请假|断更|停更|明天恢复|今日无更|今天无更|停电|电脑坏|生病住院|本章未完|防盗|补更/;
  const WEAK_BODY = /月票|推荐票|打赏|订阅|感谢/g;

  function titleCore(chapter) {
    if (chapter.type === "notice") {
      return String(chapter.rawTitle || chapter.title || "").trim();
    }
    const label = ND.parseChapterLabel(chapter.title || chapter.rawTitle || "");
    return label.name || "";
  }

  ND.classifyChapter = function (chapter, options) {
    if (chapter.type === "volumeNote") {
      return { type: "normal", score: 0, reasons: [] };
    }

    const opts = options || {};
    const reasons = [];
    let score = 0;
    const core = titleCore(chapter);
    const normalizedCore = core.replace(/[！!。.？?：:；;]+$/g, "").trim();
    const body = chapter.body || "";

    if (chapter.type === "notice") {
      score += 6;
      reasons.push("独立成段的通知/请假");
      if (/^单章/.test(core)) {
        score = 4;
        reasons.push("单章需人工确认");
      }
    } else if (JUNK_EXACT.test(normalizedCore)) {
      score += 6;
      reasons.push("标题为通知/请假/感言");
    } else if (JUNK_LEAD.test(normalizedCore) && normalizedCore.length <= 16) {
      score += 4;
      reasons.push("标题以通知类词语开头");
    } else if (/加更|月票|推荐票|打赏|感谢/.test(normalizedCore) && normalizedCore.length <= 8) {
      score += 2;
      reasons.push("标题疑似求票/感谢");
    }

    if (opts.extraKeywords) {
      const keywords = String(opts.extraKeywords)
        .split(/[,，\s]+/)
        .map(function (item) { return item.trim(); })
        .filter(Boolean);
      const hit = keywords.find(function (keyword) { return core.indexOf(keyword) !== -1; });
      if (hit) {
        score += 4;
        reasons.push("命中自定义关键词：" + hit);
      }
    }

    const length = body.length;
    if (length < 80) {
      score += 4;
      reasons.push("正文极短（<80 字）");
    } else if (length < 250) {
      score += 2;
      reasons.push("正文较短（<250 字）");
    } else if (length < 500) {
      score += 1;
      reasons.push("正文偏短（<500 字）");
    }

    if (STRONG_BODY.test(body) && length < 3000) {
      score += 2;
      reasons.push("正文含停更/请假用语");
    }

    const weakHits = body.match(WEAK_BODY);
    if (weakHits && weakHits.length >= 3 && length < 1500) {
      score += 1;
      reasons.push("正文含求票/感谢用语");
    }

    const type = score >= 6 ? "junk" : score >= 3 ? "suspect" : "normal";
    return { type: type, score: score, reasons: reasons };
  };

  ND.classifyBook = function (book, options) {
    for (const chapter of book.chapters) {
      const result = ND.classifyChapter(chapter, options);
      chapter.junkType = result.type;
      chapter.junkScore = result.score;
      chapter.reasons = result.reasons;
      chapter.manual = false;
      chapter.excluded = result.type === "junk";
    }
    ND.markDuplicates(book);
    return book;
  };

  ND.markDuplicates = function (book) {
    const seen = new Map();
    for (const chapter of book.chapters) {
      if (chapter.type === "volumeNote") continue;
      const body = String(chapter.body || "").replace(/\s+/g, "");
      if (body.length < 300) continue;
      const key = body.slice(0, 120) + "|" + body.length;
      if (seen.has(key)) {
        chapter.junkScore = (chapter.junkScore || 0) + 2;
        chapter.reasons = (chapter.reasons || []).concat("疑似重复章节");
        if (chapter.junkType === "normal") chapter.junkType = "suspect";
        if (chapter.junkType === "junk") chapter.excluded = true;
      } else {
        seen.set(key, chapter);
      }
    }
  };
})();

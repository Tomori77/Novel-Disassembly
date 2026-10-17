(function () {
  "use strict";

  const RP = (window.RP = window.RP || {});

  RP.DEFAULT_RULES = {
    volumePattern:
      "^\\s*(?:第\\s*[零〇一二三四五六七八九十百千万两0-9]+\\s*卷|卷\\s*[零〇一二三四五六七八九十百千万两0-9]+|Volume\\s+\\d+).*$",
    chapterPattern:
      "^\\s*(?:第\\s*[零〇一二三四五六七八九十百千万两0-9]+\\s*[节章回]|Chapter\\s+\\d+).*$",
    extraKeywords: "",
  };

  const CN_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
  };

  RP.normalizeText = function (text) {
    return String(text || "")
      .replace(/\uFEFF/g, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
  };

  RP.cnToNumber = function (value) {
    const source = String(value || "").trim();
    if (!source) return null;
    if (/^\d+$/.test(source)) return parseInt(source, 10);

    let total = 0;
    let section = 0;
    let num = 0;
    let seen = false;

    for (const ch of source) {
      if (Object.prototype.hasOwnProperty.call(CN_DIGITS, ch)) {
        num = CN_DIGITS[ch];
        seen = true;
      } else if (ch === "十") {
        section += (num || 1) * 10;
        num = 0;
        seen = true;
      } else if (ch === "百") {
        section += (num || 1) * 100;
        num = 0;
        seen = true;
      } else if (ch === "千") {
        section += (num || 1) * 1000;
        num = 0;
        seen = true;
      } else if (ch === "万") {
        total += (section + num) * 10000;
        section = 0;
        num = 0;
        seen = true;
      } else {
        return null;
      }
    }

    return seen ? total + section + num : null;
  };

  RP.stripSeparators = function (value) {
    return String(value || "")
      .replace(/^[\s:：、.．,，\-—–_·]+/, "")
      .trim();
  };

  RP.parseVolumeLabel = function (title) {
    const text = String(title || "").trim();
    let match = text.match(/^第\s*([零〇一二三四五六七八九十百千万两0-9]+)\s*卷/);
    if (match) {
      return {
        number: RP.cnToNumber(match[1]),
        name: RP.stripSeparators(text.slice(match[0].length)),
      };
    }
    match = text.match(/^卷\s*([零〇一二三四五六七八九十百千万两0-9]+)/);
    if (match) {
      return {
        number: RP.cnToNumber(match[1]),
        name: RP.stripSeparators(text.slice(match[0].length)),
      };
    }
    match = text.match(/^Volume\s+(\d+)/i);
    if (match) {
      return {
        number: parseInt(match[1], 10),
        name: RP.stripSeparators(text.slice(match[0].length)),
      };
    }
    return { number: null, name: RP.stripSeparators(text) };
  };

  RP.parseChapterLabel = function (title) {
    const text = String(title || "").trim();
    let match = text.match(/^第\s*([零〇一二三四五六七八九十百千万两0-9]+)\s*([节章回])/);
    if (match) {
      return {
        number: RP.cnToNumber(match[1]),
        unit: match[2],
        name: RP.stripSeparators(text.slice(match[0].length)),
      };
    }
    match = text.match(/^Chapter\s+(\d+)/i);
    if (match) {
      return {
        number: parseInt(match[1], 10),
        unit: "章",
        name: RP.stripSeparators(text.slice(match[0].length)),
      };
    }
    return { number: null, unit: "", name: RP.stripSeparators(text) };
  };

  RP.escapeHtml = function (value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch];
    });
  };

  RP.safeFileName = function (value, fallback) {
    const cleaned = String(value || "")
      .replace(/[\\/:*?"<>|\r\n\t]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "")
      .slice(0, 80)
      .trim();
    return cleaned || String(fallback || "未命名");
  };

  RP.pad = function (value, length) {
    return String(value == null ? "" : value).padStart(length, "0");
  };

  RP.formatCount = function (value) {
    return Number(value || 0).toLocaleString("zh-CN");
  };

  RP.downloadBlob = function (fileName, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  };
})();

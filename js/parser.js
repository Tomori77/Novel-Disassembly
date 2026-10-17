(function () {
  "use strict";

  const RP = window.RP;

  const NOTICE_HEAD =
    /^(?:请假(?:条|一天|两天|一周|几天)?(?:[，,。！!：:]|$)|今天无更|今日无更|明天无更|停更|断更|更新在?\s*[0-9一二三四五六七八九十]+\s*点|求月票|求推荐票|求订阅|为.{0,24}月票|(?:单章|通知|公告|说明|感言|上架感言|完本感言|卷末感言)\s*[:：]|上架感言|完本感言|卷末感言|新书预告)/;

  function buildRegex(pattern, flags) {
    try {
      return new RegExp(pattern, flags);
    } catch (error) {
      throw new Error("规则无效：" + error.message);
    }
  }

  function isHeading(line, kind) {
    const text = String(line || "").trim();
    if (!text) return false;
    const max = kind === "volume" ? 48 : 60;
    if (text.length > max) return false;
    if (kind === "volume") {
      if (/[。！？!?；;]$/.test(text)) return false;
      if (/[，,].*[，,]/.test(text)) return false;
    }
    return true;
  }

  function collectHeadings(raw, regex, kind) {
    const result = [];
    for (const match of raw.matchAll(regex)) {
      const line = match[0];
      if (!isHeading(line, kind)) continue;
      result.push({
        kind: kind,
        offset: match.index,
        lineLength: line.length,
        rawTitle: line.trim(),
      });
    }
    return result;
  }

  function collectNotices(raw, volumeRegex, chapterRegex) {
    const result = [];
    const lines = [];
    let position = 0;
    for (const line of raw.split("\n")) {
      lines.push({ text: line, start: position });
      position += line.length + 1;
    }

    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index].text.trim();
      if (!text) continue;
      if (text.length > 40 && !/^(?:单章|通知|公告|说明|感言|上架感言|完本感言|卷末感言)\s*[:：]/.test(text)) {
        continue;
      }
      if (!NOTICE_HEAD.test(text)) continue;
      if (chapterRegex.test(text) || volumeRegex.test(text)) continue;

      const prev = index > 0 ? lines[index - 1].text.trim() : "";
      const next = index < lines.length - 1 ? lines[index + 1].text.trim() : "";
      if (prev !== "" || next !== "") continue;

      result.push({
        kind: "notice",
        offset: lines[index].start,
        lineLength: lines[index].text.length,
        rawTitle: text,
      });
    }
    return result;
  }

  function extractBody(full, title, strayTitles) {
    const lines = String(full || "").split("\n");
    const expected = String(title || "").trim();
    const firstIndex = lines.findIndex(function (line) {
      return line.trim() !== "";
    });
    if (firstIndex >= 0 && lines[firstIndex].trim() === expected) {
      lines.splice(0, firstIndex + 1);
    }
    if (strayTitles && strayTitles.size) {
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (strayTitles.has(lines[index].trim())) lines.splice(index, 1);
      }
    }
    return lines.join("\n").trim();
  }

  function normalizeTitle(value) {
    return String(value || "")
      .replace(/[\s：:、.．,，!！?？。;；\-—–_"'“”‘’()（）]/g, "")
      .trim();
  }

  RP.splitBook = function (text, rules) {
    const raw = RP.normalizeText(text);
    const volumeRegex = buildRegex(rules.volumePattern, "gim");
    const chapterRegex = buildRegex(rules.chapterPattern, "gim");
    const volumeTest = buildRegex(rules.volumePattern, "im");
    const chapterTest = buildRegex(rules.chapterPattern, "im");

    const volumeMarks = collectHeadings(raw, volumeRegex, "volume");
    const chapterMarks = collectHeadings(raw, chapterRegex, "chapter");
    const noticeMarks = collectNotices(raw, volumeTest, chapterTest);
    const strayVolumeTitles = new Set();
    const dedupedVolumes = [];

    for (const mark of volumeMarks) {
      const prev = dedupedVolumes[dedupedVolumes.length - 1];
      if (prev) {
        const prevLabel = RP.parseVolumeLabel(prev.rawTitle);
        const label = RP.parseVolumeLabel(mark.rawTitle);
        const sameNumber = prevLabel.number != null && prevLabel.number === label.number;
        const sameName = prevLabel.name && prevLabel.name === label.name;
        if ((sameNumber && sameName) || (sameNumber && !label.name)) {
          if (mark.offset - prev.offset < 40000) {
            strayVolumeTitles.add(mark.rawTitle);
            continue;
          }
        }
      }
      dedupedVolumes.push(mark);
    }

    const marks = dedupedVolumes.concat(chapterMarks, noticeMarks).sort(function (a, b) {
      return a.offset - b.offset;
    });

    const volumes = [];
    let current = null;

    for (const mark of marks) {
      if (mark.kind === "volume") {
        if (current) current.endOffset = mark.offset;
        const label = RP.parseVolumeLabel(mark.rawTitle);
        const number = label.number != null ? label.number : volumes.filter(function (v) { return !v.synthetic; }).length + 1;
        current = {
          id: "V" + RP.pad(volumes.length + 1, 3),
          index: volumes.length,
          synthetic: false,
          number: number,
          name: label.name,
          rawTitle: mark.rawTitle,
          startOffset: mark.offset,
          headingEnd: mark.offset + mark.lineLength,
          endOffset: raw.length,
          marks: [],
        };
        volumes.push(current);
      } else {
        if (!current) {
          current = {
            id: "V" + RP.pad(volumes.length + 1, 3),
            index: volumes.length,
            synthetic: true,
            number: null,
            name: "序章",
            rawTitle: "序章 / 前言",
            startOffset: 0,
            headingEnd: 0,
            endOffset: raw.length,
            marks: [],
          };
          volumes.push(current);
        }
        current.marks.push(mark);
      }
    }

    if (!marks.length) {
      volumes.push({
        id: "V001",
        index: 0,
        synthetic: true,
        number: null,
        name: "全书",
        rawTitle: "全文",
        startOffset: 0,
        headingEnd: 0,
        endOffset: raw.length,
        marks: [],
      });
    }

    let chapters = [];
    let idCounter = 0;

    for (const volume of volumes) {
      volume.chapters = [];
      const firstMark = volume.marks[0];
      const noteEnd = firstMark ? firstMark.offset : volume.endOffset;
      const noteText = raw.slice(volume.headingEnd, noteEnd).trim();

      if (noteText) {
        idCounter += 1;
        const noteTitle = volume.synthetic
          ? volume.marks.length
            ? "序章 / 前言"
            : "全文"
          : (volume.name || volume.rawTitle) + " · 卷首语";
        const note = {
          id: "C" + RP.pad(idCounter, 5),
          type: volume.synthetic ? "preface" : "volumeNote",
          rawTitle: noteTitle,
          title: noteTitle,
          body: noteText,
          text: noteText,
          volumeId: volume.id,
          globalIndex: null,
          localIndex: null,
          labelNumber: null,
          labelUnit: "",
          excluded: false,
        };
        volume.chapters.push(note);
        chapters.push(note);
      }

      volume.marks.forEach(function (mark, index) {
        const endOffset = volume.marks[index + 1] ? volume.marks[index + 1].offset : volume.endOffset;
        const full = raw.slice(mark.offset, endOffset);
        const body = extractBody(full, mark.rawTitle, strayVolumeTitles);
        const label = mark.kind === "chapter" ? RP.parseChapterLabel(mark.rawTitle) : { number: null, unit: "", name: "" };
        idCounter += 1;
        const chapter = {
          id: "C" + RP.pad(idCounter, 5),
          type: mark.kind === "notice" ? "notice" : "chapter",
          rawTitle: mark.rawTitle,
          title: mark.rawTitle,
          body: body,
          text: full.trim(),
          volumeId: volume.id,
          globalIndex: null,
          localIndex: null,
          labelNumber: label.number,
          labelUnit: label.unit,
          offset: mark.offset,
          endOffset: endOffset,
          excluded: false,
        };
        volume.chapters.push(chapter);
        chapters.push(chapter);
      });
    }

    for (const volume of volumes) {
      const kept = [];
      volume.chapters.forEach(function (chapter, index) {
        if (chapter.type === "chapter" && !chapter.body) {
          const next = volume.chapters.slice(index + 1).find(function (item) {
            return item.type === "chapter" || item.type === "notice";
          });
          if (next && normalizeTitle(chapter.rawTitle) === normalizeTitle(next.rawTitle)) return;
        }
        kept.push(chapter);
      });
      volume.chapters = kept;
    }

    chapters = [];
    for (const volume of volumes) chapters = chapters.concat(volume.chapters);

    let contentIndex = 0;
    for (const volume of volumes) {
      let localIndex = 0;
      for (const chapter of volume.chapters) {
        if (chapter.type === "chapter" || chapter.type === "preface") {
          contentIndex += 1;
          localIndex += 1;
          chapter.globalIndex = contentIndex;
          chapter.localIndex = localIndex;
        }
      }
    }

    const stats = {
      chars: raw.length,
      volumes: volumes.filter(function (v) { return !v.synthetic; }).length,
      chapters: 0,
      notices: 0,
      notes: 0,
    };
    for (const chapter of chapters) {
      if (chapter.type === "chapter" || chapter.type === "preface") stats.chapters += 1;
      if (chapter.type === "notice") stats.notices += 1;
      if (chapter.type === "volumeNote") stats.notes += 1;
    }

    return {
      rawText: raw,
      volumes: volumes,
      chapters: chapters,
      stats: stats,
    };
  };

  RP.cleanExportBody = function (body, options) {
    const opts = options || {};
    let lines = String(body || "").split("\n");

    if (opts.cleanWatermark) {
      lines = lines.filter(function (line) {
        const text = line.trim();
        return !(text.length <= 60 && /(更新快|纯文字|笔趣阁|无弹窗|请记住本站|最新章节|全文阅读|www\.|https?:\/\/|\.com|\.net)/i.test(text));
      });
    }

    if (opts.cleanTrailingNotes) {
      const start = Math.max(0, Math.floor(lines.length * 0.5));
      for (let index = start; index < lines.length; index += 1) {
        const text = lines[index].trim();
        if (!text) continue;
        const isNote =
          /^(?:ps|PS|Ps|p\.s\.)[\s:：]/.test(text) ||
          /^作者的话/.test(text) ||
          /^(?:通知|公告|单章)[:：]/.test(text) ||
          /^请假/.test(text) ||
          /^(?:今天无更|今日无更|明天无更)/.test(text) ||
          /^更新在?\s*[0-9一二三四五六七八九十]+\s*点/.test(text) ||
          /^(?:求|呼唤|为).{0,20}(?:月票|推荐票|订阅)/.test(text) ||
          /^感谢.{0,10}(?:支持|打赏|月票|订阅)/.test(text);
        if (isNote) {
          lines = lines.slice(0, index);
          break;
        }
      }
    }

    return lines.join("\n").trim();
  };
})();

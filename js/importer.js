(function () {
  "use strict";

  const ND = window.ND;
  const utf8Decoder = new TextDecoder("utf-8");
  const MANIFEST_NAME = "_manifest.json";
  const META_FILES = /^(目录|剔除清单)\.txt$/i;
  const MANIFEST_FORMATS = ["novel-disassembly/1", "rp-disassembly/1"];

  function decodeText(bytes) {
    const text = utf8Decoder.decode(bytes || new Uint8Array(0));
    const broken = (text.match(/\uFFFD/g) || []).length;
    if (broken > 20 && broken / Math.max(1, text.length) > 0.0005) {
      try {
        return new TextDecoder("gb18030").decode(bytes);
      } catch (error) {
        return text;
      }
    }
    return text;
  }

  function entryText(entry) {
    if (typeof entry.text === "string") return entry.text;
    return decodeText(entry.bytes);
  }

  function normalizePath(path) {
    return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  }

  function baseName(path) {
    const clean = normalizePath(path);
    const index = clean.lastIndexOf("/");
    return index < 0 ? clean : clean.slice(index + 1);
  }

  function folderName(prefix) {
    return String(prefix || "").replace(/\/+$/, "").split("/").pop() || "";
  }

  function normalizeEntries(entries) {
    const list = [];
    (entries || []).forEach(function (entry) {
      const path = normalizePath(entry.path);
      if (!path) return;
      list.push({
        path: path,
        text: typeof entry.text === "string" ? entry.text : null,
        bytes: typeof entry.text === "string" ? null : entry.bytes,
      });
    });
    return list;
  }

  function buildStats(rawText, volumes, chapters) {
    const stats = {
      chars: rawText.length,
      volumes: volumes.filter(function (volume) { return !volume.synthetic; }).length,
      chapters: 0,
      notices: 0,
      notes: 0,
    };
    chapters.forEach(function (chapter) {
      if (chapter.type === "chapter" || chapter.type === "preface") stats.chapters += 1;
      if (chapter.type === "notice") stats.notices += 1;
      if (chapter.type === "volumeNote") stats.notes += 1;
    });
    return stats;
  }

  function makeChapter(source, volumeId, index) {
    const type = source.type || "chapter";
    return {
      id: "C" + ND.pad(index, 5),
      type: type,
      rawTitle: source.rawTitle || source.title || "未命名章节",
      title: source.title || source.rawTitle || "未命名章节",
      body: source.body || "",
      text: source.text || "",
      volumeId: volumeId,
      globalIndex: source.globalIndex != null ? source.globalIndex : null,
      localIndex: source.localIndex != null ? source.localIndex : null,
      labelNumber: source.labelNumber != null ? source.labelNumber : null,
      labelUnit: source.labelUnit || "",
      excluded: !!source.excluded,
      reasons: (source.reasons || []).slice(),
      junkType: source.junkType || (source.excluded ? "junk" : "normal"),
      junkScore: source.junkScore || 0,
    };
  }

  function stripTitle(text, title) {
    const lines = text.split("\n");
    let index = 0;
    while (index < lines.length && !lines[index].trim()) index += 1;
    if (index < lines.length && lines[index].trim() === String(title || "").trim()) {
      return lines.slice(index + 1).join("\n").trim();
    }
    return text.trim();
  }

  function importManifest(list, manifestEntry, rootPrefix) {
    let data;
    try {
      data = JSON.parse(entryText(manifestEntry));
    } catch (error) {
      throw new Error("_manifest.json 解析失败：" + error.message);
    }
    if (!data || MANIFEST_FORMATS.indexOf(data.format) === -1) {
      throw new Error(
        "不支持的 manifest 格式：" +
          (data && data.format ? data.format : "未知") +
          "；支持：" +
          MANIFEST_FORMATS.join("、"),
      );
    }

    const byPath = new Map();
    list.forEach(function (entry) { byPath.set(entry.path, entry); });
    function findFile(file) {
      const relative = normalizePath(file);
      return byPath.get(rootPrefix + relative) || byPath.get(relative);
    }

    const bookName = ND.safeFileName(data.book || folderName(rootPrefix), "导入的书");
    const volumes = [];
    const chapters = [];
    const parts = [];
    let missing = 0;

    (data.volumes || []).forEach(function (source, volumeIndex) {
      const synthetic = !!source.synthetic;
      const number = source.number != null ? source.number : null;
      const name = source.name || "";
      const rawTitle = source.title || (synthetic ? "序章 / 前言" : "第" + (number != null ? number : volumeIndex + 1) + "卷");
      const volume = {
        id: "V" + ND.pad(volumes.length + 1, 3),
        index: volumes.length,
        synthetic: synthetic,
        number: number,
        name: name,
        rawTitle: rawTitle,
        chapters: [],
      };
      if (rawTitle) parts.push(rawTitle);

      (source.chapters || []).forEach(function (item) {
        const entry = findFile(item.file);
        if (!entry) {
          missing += 1;
          return;
        }
        const raw = ND.normalizeText(entryText(entry));
        const title = item.title || item.rawTitle || "未命名章节";
        const chapter = makeChapter(
          {
            type: item.type || "chapter",
            rawTitle: item.rawTitle || title,
            title: title,
            body: stripTitle(raw, title),
            text: raw,
            globalIndex: item.globalIndex,
            localIndex: item.localIndex,
            labelNumber: item.labelNumber,
            labelUnit: item.labelUnit,
            excluded: item.excluded,
            reasons: item.reasons,
            junkType: item.junkType,
            junkScore: item.junkScore,
          },
          volume.id,
          chapters.length + 1,
        );
        volume.chapters.push(chapter);
        chapters.push(chapter);
        parts.push(chapter.title);
        if (chapter.body) parts.push(chapter.body);
      });

      volumes.push(volume);
    });

    const rawText = parts.join("\n\n");
    return {
      fileName: bookName + ".txt",
      rawText: rawText,
      volumes: volumes,
      chapters: chapters,
      stats: buildStats(rawText, volumes, chapters),
      reconstructed: true,
      manifest: true,
      missingFiles: missing,
    };
  }

  function commonRoot(list) {
    let root = null;
    for (const entry of list) {
      const index = entry.path.indexOf("/");
      if (index < 1) return "";
      const top = entry.path.slice(0, index);
      if (root === null) root = top;
      else if (root !== top) return "";
    }
    return root || "";
  }

  function numericPrefix(value) {
    const match = normalizePath(value).match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
  }

  function volumeInfo(dir, index) {
    if (!dir) {
      return { synthetic: true, number: null, name: "序章", rawTitle: "序章 / 前言", sort: -1 };
    }
    const match = dir.match(/^(\d+)[_\-.\s]*(.*)$/);
    const prefix = match ? parseInt(match[1], 10) : null;
    const label = match ? match[2].trim() : dir.trim();
    if (prefix === 0 || /^(序章|前言|序)$/.test(label)) {
      return { synthetic: true, number: null, name: label || "序章", rawTitle: "序章 / 前言", sort: -1 };
    }
    const name = label || dir;
    return {
      synthetic: false,
      number: prefix,
      name: name,
      rawTitle: prefix != null ? "第" + prefix + "卷 " + name : name,
      sort: prefix != null ? prefix : 900000 + index,
    };
  }

  function inferTitle(text, path) {
    const fallback = baseName(path).replace(/\.txt$/i, "").replace(/^\d+_/, "").trim() || "未命名章节";
    const lines = text.split("\n");
    let index = 0;
    while (index < lines.length && !lines[index].trim()) index += 1;
    if (index < lines.length) {
      const line = lines[index].trim();
      const heading =
        line.length <= 60 &&
        (/^第\s*[零〇一二三四五六七八九十百千万两0-9]+\s*[节章回]/.test(line) || /^Chapter\s+\d+/i.test(line));
      if (heading) {
        return { title: line, body: lines.slice(index + 1).join("\n").trim() };
      }
    }
    return { title: fallback, body: text.trim() };
  }

  function importTree(list) {
    let bookName;
    const root = commonRoot(list);
    let entries = list;
    if (root) {
      bookName = root;
      entries = list.map(function (entry) {
        return {
          path: entry.path.slice(root.length + 1),
          text: entry.text,
          bytes: entry.bytes,
        };
      });
    } else {
      const firstTxt = list.find(function (entry) {
        return /\.txt$/i.test(entry.path) && !META_FILES.test(baseName(entry.path));
      });
      const index = firstTxt ? firstTxt.path.indexOf("/") : -1;
      bookName = index > 0 ? firstTxt.path.slice(0, index) : "导入的书";
    }

    const groups = new Map();
    entries.forEach(function (entry) {
      if (!/\.txt$/i.test(entry.path)) return;
      if (META_FILES.test(baseName(entry.path))) return;
      const index = entry.path.indexOf("/");
      const dir = index < 0 ? "" : entry.path.slice(0, index);
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir).push(entry);
    });

    const items = Array.from(groups.keys()).map(function (dir, index) {
      return { dir: dir, info: volumeInfo(dir, index) };
    });
    items.sort(function (a, b) {
      return a.info.sort - b.info.sort || a.dir.localeCompare(b.dir, "zh-CN");
    });

    const syntheticFiles = [];
    const volumeItems = [];
    items.forEach(function (item) {
      if (item.info.synthetic) syntheticFiles.push.apply(syntheticFiles, groups.get(item.dir));
      else volumeItems.push(item);
    });

    const volumes = [];
    const chapters = [];
    const parts = [];
    let globalIndex = 0;

    function addVolume(info, files) {
      const volume = {
        id: "V" + ND.pad(volumes.length + 1, 3),
        index: volumes.length,
        synthetic: info.synthetic,
        number: info.number,
        name: info.name,
        rawTitle: info.rawTitle,
        chapters: [],
      };
      volumes.push(volume);
      if (info.rawTitle) parts.push(info.rawTitle);

      files.sort(function (a, b) {
        const delta = numericPrefix(baseName(a.path)) - numericPrefix(baseName(b.path));
        if (delta) return delta;
        return baseName(a.path).localeCompare(baseName(b.path), "zh-CN");
      });

      let localIndex = 0;
      files.forEach(function (entry) {
        const text = ND.normalizeText(entryText(entry));
        const inferred = inferTitle(text, entry.path);
        const label = ND.parseChapterLabel(inferred.title);
        globalIndex += 1;
        localIndex += 1;
        const chapter = makeChapter(
          {
            type: "chapter",
            rawTitle: inferred.title,
            title: inferred.title,
            body: inferred.body,
            text: text,
            globalIndex: globalIndex,
            localIndex: localIndex,
            labelNumber: label.number,
            labelUnit: label.unit,
            excluded: false,
            reasons: [],
          },
          volume.id,
          chapters.length + 1,
        );
        volume.chapters.push(chapter);
        chapters.push(chapter);
        parts.push(chapter.title);
        if (chapter.body) parts.push(chapter.body);
      });
    }

    if (syntheticFiles.length) {
      addVolume(volumeInfo("", 0), syntheticFiles);
    }
    volumeItems.forEach(function (item) {
      addVolume(item.info, groups.get(item.dir));
    });

    const rawText = parts.join("\n\n");
    return {
      fileName: ND.safeFileName(bookName || folderName(root), "导入的书") + ".txt",
      rawText: rawText,
      volumes: volumes,
      chapters: chapters,
      stats: buildStats(rawText, volumes, chapters),
      reconstructed: true,
      manifest: false,
      missingFiles: 0,
    };
  }

  ND.importFromEntries = function (entries) {
    const list = normalizeEntries(entries);
    if (!list.length) throw new Error("没有可读取的文件");

    const manifests = list
      .filter(function (entry) { return baseName(entry.path).toLowerCase() === MANIFEST_NAME; })
      .sort(function (a, b) {
        return a.path.length - b.path.length || a.path.localeCompare(b.path);
      });

    if (!manifests.length) return importTree(list);

    const manifestEntry = manifests[0];
    const index = manifestEntry.path.lastIndexOf("/");
    const rootPrefix = index < 0 ? "" : manifestEntry.path.slice(0, index + 1);
    return importManifest(list, manifestEntry, rootPrefix);
  };
})();

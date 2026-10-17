(function () {
  "use strict";

  const RP = window.RP;
  const MANIFEST_FORMAT = "rp-disassembly/1";

  function baseName(fileName) {
    return String(fileName || "未命名").replace(/\.txt$/i, "").trim() || "未命名";
  }

  function normalizeOptions(options) {
    const opts = options || {};
    return {
      includeExcluded: !!opts.includeExcluded,
      includeNotes: opts.includeNotes !== false,
      useEditedTitles: opts.useEditedTitles !== false,
      cleanWatermark: opts.cleanWatermark !== false,
      cleanTrailingNotes: opts.cleanTrailingNotes !== false,
    };
  }

  function resolveTitle(chapter, options) {
    const primary = options.useEditedTitles ? chapter.title || chapter.rawTitle : chapter.rawTitle || chapter.title;
    if (primary) return primary;
    if (chapter.type === "volumeNote") return "卷首语";
    if (chapter.type === "preface") return "序章 / 前言";
    return chapter.globalIndex ? "第" + chapter.globalIndex + "节" : "章节";
  }

  function chapterBody(chapter, options) {
    return RP.cleanExportBody(chapter.body || "", options);
  }

  function collect(book, options) {
    const groups = [];
    for (const volume of book.volumes) {
      const chapters = volume.chapters.filter(function (chapter) {
        if (chapter.type === "volumeNote" && !options.includeNotes) return false;
        if (chapter.type === "preface" && !options.includeNotes) return false;
        if (chapter.excluded && !options.includeExcluded) return false;
        return true;
      });
      if (chapters.length) groups.push({ volume: volume, chapters: chapters });
    }
    return groups;
  }

  function volumeHeading(volume) {
    if (volume.synthetic) return "";
    return volume.rawTitle;
  }

  function findVolume(book, chapter) {
    return (book.volumes || []).find(function (volume) {
      return volume.id === chapter.volumeId;
    }) || null;
  }

  function buildEntry(book, volume, chapter, options) {
    const title = resolveTitle(chapter, options);
    return {
      book: {
        name: baseName(book.fileName),
        fileName: String(book.fileName || ""),
      },
      volume: {
        id: volume ? volume.id : chapter.volumeId || "",
        title: volume ? volume.rawTitle || "" : "",
        number: volume && volume.number != null ? volume.number : null,
        name: volume && volume.name ? volume.name : "",
        synthetic: !!(volume && volume.synthetic),
        index: volume && volume.index != null ? volume.index : 0,
      },
      chapter: {
        id: chapter.id || "",
        type: chapter.type || "chapter",
        title: title,
        rawTitle: chapter.rawTitle || title,
        body: chapterBody(chapter, options),
        excluded: !!chapter.excluded,
        reasons: (chapter.reasons || []).slice(),
      },
      index: {
        global: chapter.globalIndex != null ? chapter.globalIndex : null,
        local: chapter.localIndex != null ? chapter.localIndex : null,
        labelNumber: chapter.labelNumber != null ? chapter.labelNumber : null,
        labelUnit: chapter.labelUnit || "",
      },
      meta: {},
    };
  }

  function normalizeTemplates(source) {
    const base = RP.plugins.templates();
    if (!source || typeof source !== "object") return base;
    const result = {};
    Object.keys(RP.plugins.DEFAULT_TEMPLATES).forEach(function (key) {
      result[key] = typeof source[key] === "string" ? source[key] : base[key];
    });
    return result;
  }

  function prepareItem(book, volume, chapter, options, templates) {
    const entry = buildEntry(book, volume, chapter, options);
    const ctx = { book: entry.book, options: options, variables: null };
    RP.plugins.normalize(entry, ctx);
    const variables = RP.plugins.variables(entry, ctx);

    const rawTitle = entry.chapter && entry.chapter.rawTitle != null ? String(entry.chapter.rawTitle) : "";
    const titleText = entry.chapter && entry.chapter.title != null ? String(entry.chapter.title) : "";
    const title = titleText || rawTitle || "章节";
    const body = entry.chapter && entry.chapter.body != null ? String(entry.chapter.body) : "";
    const header = RP.plugins.render(templates.header, variables);

    return {
      chapter: chapter,
      entry: entry,
      variables: variables,
      title: title,
      body: body,
      header: header,
    };
  }

  function prepareGroup(book, group, options, templates) {
    return group.chapters.map(function (chapter) {
      return prepareItem(book, group.volume, chapter, options, templates);
    });
  }

  function composeContent(header, body) {
    const head = header == null ? "" : String(header);
    const content = body == null ? "" : String(body);
    if (!content) return head;
    return head ? head + "\n\n" + content : content;
  }

  function chapterFilePath(item, templates) {
    const rendered = RP.plugins.render(templates.chapterFile, item.variables);
    const fallback = RP.plugins.render(RP.plugins.DEFAULT_TEMPLATES.chapterFile, item.variables);
    let name = RP.plugins.safePath(rendered, fallback);
    if (!/\.txt$/i.test(name)) name += ".txt";
    return name;
  }

  function volumeFolderPath(items, templates) {
    const variables = items[0].variables;
    const rendered = RP.plugins.render(templates.volumeFolder, variables);
    const fallback = RP.plugins.render(RP.plugins.DEFAULT_TEMPLATES.volumeFolder, variables);
    return RP.plugins.safePath(rendered, fallback);
  }

  function groupHeading(items, volume) {
    if (volume.synthetic) return "";
    const entryTitle = items.length ? items[0].entry.volume.title || "" : "";
    return entryTitle || volumeHeading(volume);
  }

  function removedText(removed) {
    const lines = ["共 " + removed.length + " 条", ""];
    removed.forEach(function (chapter) {
      const reasons = (chapter.reasons || []).join("；") || "手动排除";
      lines.push(
        "[" + (chapter.type === "notice" ? "通知" : "章节") + "] " +
          (chapter.globalIndex != null ? RP.pad(chapter.globalIndex, 4) : "----") +
          "  " + (chapter.rawTitle || chapter.title) +
          " — " + reasons,
      );
    });
    return lines.join("\n");
  }

  function planExport(book, options) {
    const groups = collect(book, options);
    const templates = RP.plugins.templates();
    const root = RP.safeFileName(baseName(book.fileName), "书");
    const files = [];
    const volumes = [];
    const directory = [];
    const usedPaths = new Set();
    const usedFolders = new Set();

    directory.push("《" + baseName(book.fileName) + "》");
    directory.push("共 " + groups.length + " 卷 / " + RP.formatCount(book.stats.chapters) + " 节");
    directory.push("");

    for (const group of groups) {
      const items = prepareGroup(book, group, options, templates);
      if (!items.length) continue;

      let folder = volumeFolderPath(items, templates);
      if (usedFolders.has(folder)) {
        let suffix = 2;
        while (usedFolders.has(folder + "_" + suffix)) suffix += 1;
        folder += "_" + suffix;
      }
      usedFolders.add(folder);

      const heading = groupHeading(items, group.volume);
      directory.push((heading || "序章") + "（" + group.chapters.length + " 个文件）");
      const chapters = [];

      for (const item of items) {
        const title = item.title;
        const body = item.body;
        let name = chapterFilePath(item, templates);
        let path = folder + "/" + name;
        if (usedPaths.has(path)) {
          const slash = path.lastIndexOf("/");
          const directoryPart = path.slice(0, slash + 1);
          const base = path.slice(slash + 1);
          const hasExt = /\.txt$/i.test(base);
          const stem = hasExt ? base.slice(0, -4) : base;
          const ext = hasExt ? ".txt" : "";
          let suffix = 2;
          while (usedPaths.has(directoryPart + stem + "_" + suffix + ext)) suffix += 1;
          path = directoryPart + stem + "_" + suffix + ext;
        }
        usedPaths.add(path);

        files.push({ path: path, content: composeContent(item.header, body) });
        chapters.push({
          file: path,
          title: title,
          rawTitle: item.entry.chapter.rawTitle || title,
          type: item.entry.chapter.type || "chapter",
          globalIndex: item.entry.index.global != null ? item.entry.index.global : null,
          localIndex: item.entry.index.local != null ? item.entry.index.local : null,
          labelNumber: item.entry.index.labelNumber != null ? item.entry.index.labelNumber : null,
          labelUnit: item.entry.index.labelUnit || "",
          excluded: !!item.entry.chapter.excluded,
          reasons: (item.entry.chapter.reasons || []).slice(),
          junkType: item.chapter.junkType || "normal",
          junkScore: item.chapter.junkScore || 0,
        });
        directory.push("  " + path.slice(folder.length + 1));
      }

      const volumeEntry = items[0].entry.volume;
      volumes.push({
        title: volumeEntry.title || group.volume.rawTitle,
        number: group.volume.number != null ? group.volume.number : null,
        name: volumeEntry.name || group.volume.name || "",
        synthetic: !!group.volume.synthetic,
        chapters: chapters,
      });
      directory.push("");
    }

    return {
      root: root,
      files: files,
      volumes: volumes,
      directory: directory,
      removed: book.chapters.filter(function (chapter) { return chapter.excluded; }),
      templates: templates,
    };
  }

  function manifestPlugins() {
    return RP.plugins
      .list()
      .filter(function (plugin) {
        return plugin.enabled && plugin.compatible && plugin.registered;
      })
      .map(function (plugin) {
        return { id: plugin.id, version: plugin.version };
      });
  }

  function manifestFromPlan(options, plan) {
    return {
      format: MANIFEST_FORMAT,
      book: plan.root,
      exportedAt: new Date().toISOString(),
      options: options,
      plugins: manifestPlugins(),
      templates: plan.templates || RP.plugins.templates(),
      volumes: plan.volumes,
    };
  }

  RP.buildManifest = function (book, options) {
    const opts = normalizeOptions(options);
    return manifestFromPlan(opts, planExport(book, opts));
  };

  RP.buildPlainText = function (book, options) {
    const opts = normalizeOptions(options);
    const templates = RP.plugins.templates();
    const groups = collect(book, opts);
    const parts = [];
    for (const group of groups) {
      const items = prepareGroup(book, group, opts, templates);
      if (!items.length) continue;
      const heading = groupHeading(items, group.volume);
      if (heading) parts.push(heading + "\n");
      const chapterBlocks = items.map(function (item) {
        return composeContent(item.header, item.body);
      });
      parts.push(chapterBlocks.join("\n\n———\n\n"));
    }
    return parts.join("\n\n\n");
  };

  RP.exportPlainText = function (book, options) {
    const text = RP.buildPlainText(book, options);
    return {
      fileName: baseName(book.fileName) + "_分卷.txt",
      blob: new Blob([text], { type: "text/plain;charset=utf-8" }),
      size: text.length,
    };
  };

  RP.exportZip = function (book, options) {
    const opts = normalizeOptions(options);
    const plan = planExport(book, opts);
    const zip = new RP.ZipWriter();

    plan.files.forEach(function (file) {
      zip.add(plan.root + "/" + file.path, file.content);
    });
    zip.add(plan.root + "/目录.txt", plan.directory.join("\n"));
    if (plan.removed.length) {
      zip.add(plan.root + "/剔除清单.txt", removedText(plan.removed));
    }
    zip.add(plan.root + "/_manifest.json", JSON.stringify(manifestFromPlan(opts, plan), null, 2));

    return {
      fileName: plan.root + "_分卷.zip",
      blob: zip.blob("application/zip"),
    };
  };

  RP.exportFolder = function (book, options) {
    const opts = normalizeOptions(options);
    const plan = planExport(book, opts);
    const files = plan.files.slice();
    files.push({ path: "目录.txt", content: plan.directory.join("\n") });
    if (plan.removed.length) {
      files.push({ path: "剔除清单.txt", content: removedText(plan.removed) });
    }
    files.push({
      path: "_manifest.json",
      content: JSON.stringify(manifestFromPlan(opts, plan), null, 2),
    });

    const epub = RP.exportEpub(book, opts);
    epub.fileName = plan.root + ".epub";

    return {
      fileName: plan.root,
      files: files,
      epub: epub,
    };
  };

  function xmlEscape(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function xhtmlDocument(title, body) {
    const paragraphs = String(body || "")
      .split(/\n+/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .map(function (line) { return "<p>" + xmlEscape(line) + "</p>"; })
      .join("\n");
    return (
      '<?xml version="1.0" encoding="utf-8"?>\n' +
      "<!DOCTYPE html>\n" +
      '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">\n' +
      "<head><meta charset=\"utf-8\"/><title>" + xmlEscape(title) + "</title>" +
      '<link rel="stylesheet" type="text/css" href="../style.css"/></head>\n' +
      "<body><h1>" + xmlEscape(title) + "</h1>\n" + paragraphs + "\n</body>\n</html>"
    );
  }

  RP.exportEpub = function (book, options) {
    const opts = normalizeOptions(options);
    const templates = RP.plugins.templates();
    const groups = collect(book, opts);
    const zip = new RP.ZipWriter();
    const title = baseName(book.fileName);
    const identifier = "urn:uuid:" + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const manifest = [];
    const spine = [];
    const navSections = [];
    let index = 0;

    zip.add("mimetype", "application/epub+zip");
    zip.add(
      "META-INF/container.xml",
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>\n' +
        "</container>",
    );
    zip.add(
      "OEBPS/style.css",
      "body{font-family:serif;line-height:1.85;margin:1.4em;color:#222}\n" +
        "h1{font-size:1.4em;line-height:1.4;margin:1.2em 0 0.8em}\n" +
        "p{margin:0.55em 0;text-indent:2em}\n" +
        "nav ol{list-style:none;padding-left:1em}\n",
    );

    for (const group of groups) {
      const items = prepareGroup(book, group, opts, templates);
      if (!items.length) continue;
      const heading = groupHeading(items, group.volume) || "序章";
      const navItems = [];
      for (const item of items) {
        index += 1;
        const id = "c" + RP.pad(index, 5);
        const href = "text/" + id + ".xhtml";
        const chapterTitle = item.title;
        zip.add("OEBPS/" + href, xhtmlDocument(item.header || chapterTitle, item.body));
        manifest.push('<item id="' + id + '" href="' + href + '" media-type="application/xhtml+xml"/>');
        spine.push('<itemref idref="' + id + '"/>');
        navItems.push('<li><a href="' + href + '">' + xmlEscape(chapterTitle) + "</a></li>");
      }
      if (navItems.length) {
        navSections.push("<li><span>" + xmlEscape(heading) + "</span><ol>" + navItems.join("") + "</ol></li>");
      }
    }

    zip.add(
      "OEBPS/nav.xhtml",
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        "<!DOCTYPE html>\n" +
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">\n' +
        "<head><meta charset=\"utf-8\"/><title>目录</title></head>\n" +
        '<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>' + navSections.join("") + "</ol></nav></body>\n</html>",
    );

    const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    zip.add(
      "OEBPS/content.opf",
      '<?xml version="1.0" encoding="utf-8"?>\n' +
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">\n' +
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
        '<dc:identifier id="bookid">' + identifier + "</dc:identifier>\n" +
        "<dc:title>" + xmlEscape(title) + "</dc:title>\n" +
        "<dc:language>zh-CN</dc:language>\n" +
        '<meta property="dcterms:modified">' + modified + "</meta>\n" +
        "</metadata>\n" +
        "<manifest>\n" +
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n' +
        '<item id="css" href="style.css" media-type="text/css"/>\n' +
        manifest.join("\n") + "\n</manifest>\n" +
        "<spine>\n" + spine.join("\n") + "\n</spine>\n" +
        "</package>",
    );

    return {
      fileName: title + ".epub",
      blob: zip.blob("application/epub+zip"),
    };
  };

  RP.buildEpubBlob = function (book, options) {
    return RP.exportEpub(book, options).blob;
  };

  RP.buildChapterFile = function (book, chapter, options) {
    const opts = normalizeOptions(options);
    const templates = RP.plugins.templates();
    const volume = findVolume(book, chapter);
    const item = prepareItem(book, volume, chapter, opts, templates);
    let fileName = chapterFilePath(item, templates);
    const slash = fileName.lastIndexOf("/");
    if (slash >= 0) fileName = fileName.slice(slash + 1);
    return {
      fileName: fileName,
      content: composeContent(item.header, item.body),
      title: item.title,
      entry: item.entry,
      variables: item.variables,
    };
  };

  RP.buildTemplatePreview = function (book, options, templatesOverride) {
    if (!book) return null;
    const opts = normalizeOptions(options);
    const templates = normalizeTemplates(templatesOverride);
    const groups = collect(book, opts);
    let fallback = null;
    for (const group of groups) {
      if (!group.chapters.length) continue;
      const items = prepareGroup(book, group, opts, templates);
      if (!items.length) continue;
      const folder = volumeFolderPath(items, templates);
      const contentItem =
        items.find(function (item) {
          return item.entry.chapter.type === "chapter" || item.entry.chapter.type === "preface";
        }) || items[0];
      const file = chapterFilePath(contentItem, templates);
      const result = {
        volumeFolder: folder,
        chapterFile: file,
        header: contentItem.header,
        title: contentItem.title,
        path: folder + "/" + file,
        variables: contentItem.variables,
      };
      if (contentItem.entry.chapter.type === "chapter" || contentItem.entry.chapter.type === "preface") {
        return result;
      }
      if (!fallback) fallback = result;
    }
    return fallback;
  };

  RP.countSelection = function (book, options) {
    const opts = normalizeOptions(options);
    let total = 0;
    let excluded = 0;
    for (const group of collect(book, opts)) total += group.chapters.length;
    for (const chapter of book.chapters) if (chapter.excluded) excluded += 1;
    return { total: total, excluded: excluded };
  };
})();

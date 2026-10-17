(function () {
  "use strict";

  const ND = window.ND;
  const $ = function (id) {
    return document.getElementById(id);
  };
  const RULES_KEY = "novel-disassembly-rules-v1";
  const OPTIONS_KEY = "novel-disassembly-options-v1";

  const state = {
    fileName: "",
    book: null,
    selectedId: "",
    collapsed: new Set(),
    filter: "",
    view: "source",
    cleanSelection: new Set(),
    cleanAnchorId: "",
    cleanPreviewId: "",
    cleanDragging: false,
    options: {
      includeExcluded: false,
      includeNotes: true,
      useEditedTitles: true,
      cleanWatermark: true,
      cleanTrailingNotes: true,
    },
  };

  const SAVE_DELAY = 400;
  let cleanDrag = {
    armed: false,
    dragged: false,
    startIndex: 0,
    lastIndex: 0,
    append: false,
    base: null,
  };
  const exportTarget = {
    ready: false,
    result: null,
  };
  // key: "plugin:<pluginId>:<viewId>" → { view, panel, ctx, mounted }
  let pluginViewRegistry = Object.create(null);
  const persist = {
    available: true,
    ready: false,
    noticeShown: false,
    saving: 0,
    saveTimer: 0,
    settingsTimer: 0,
    chain: Promise.resolve(),
    chapters: new Set(),
    bookDirty: false,
    fullDirty: false,
  };

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      toast.classList.remove("show");
    }, 2800);
  }

  function isPluginView(viewName) {
    return typeof viewName === "string" && viewName.indexOf("plugin:") === 0;
  }

  function notifyBookChanged() {
    window.dispatchEvent(
      new CustomEvent("nd:book-changed", { detail: { book: state.book } }),
    );
  }

  function notifyChapterChanged() {
    window.dispatchEvent(
      new CustomEvent("nd:chapter-changed", { detail: { chapter: selectedChapter() } }),
    );
  }

  function loadJSON(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      return;
    }
  }

  function bookTitle(fileName) {
    return String(fileName || "").replace(/\.txt$/i, "").trim() || "未命名";
  }

  function sourceLabel(source) {
    if (source === "zip") return "ZIP";
    if (source === "folder") return "文件夹";
    return "TXT";
  }

  function formatDateTime(value) {
    const date = new Date(String(value || ""));
    if (isNaN(date.getTime())) return "未知时间";
    function pad(value) {
      return String(value).padStart(2, "0");
    }
    return (
      date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
      " " + pad(date.getHours()) + ":" + pad(date.getMinutes())
    );
  }

  function validView(name) {
    // 插件视图在插件加载完成后才存在；switchView 会在缺失时回退到插件页。
    if (isPluginView(name)) return name;
    const allowed = ["source", "clean", "toc", "reader", "export", "plugins"];
    return allowed.indexOf(name) === -1 ? "source" : name;
  }

  function renderSaveStatus() {
    const node = $("saveStatus");
    if (!node) return;
    node.classList.remove("saving", "off");
    if (!persist.available) {
      node.textContent = "保存状态：未持久化";
      node.classList.add("off");
      return;
    }
    if (persist.saving > 0) {
      node.textContent = "保存状态：保存中";
      node.classList.add("saving");
      return;
    }
    node.textContent = persist.ready ? "保存状态：已保存" : "保存状态：检查中";
  }

  function persistenceError(error) {
    persist.available = false;
    persist.saving = 0;
    cancelPendingWrites();
    renderSaveStatus();
    renderShelf();
    if (!persist.noticeShown) {
      persist.noticeShown = true;
      showToast(
        "持久化不可用：" + ((error && error.message) || "未知错误") + "；本次修改只保留在内存",
      );
    }
  }

  function enqueue(work, silent) {
    persist.chain = persist.chain.then(function () {
      if (!persist.available) return null;
      if (!silent) {
        persist.saving += 1;
        renderSaveStatus();
      }
      return Promise.resolve()
        .then(work)
        .then(function () {
          persist.ready = true;
        })
        .catch(function (error) {
          persistenceError(error);
        })
        .then(function () {
          if (!silent && persist.available) {
            persist.saving = Math.max(0, persist.saving - 1);
          }
          renderSaveStatus();
        });
    });
    return persist.chain;
  }

  function queueChapter(chapter) {
    if (!chapter || !state.book || !persist.available) return;
    persist.chapters.add(chapter.id);
    persist.bookDirty = true;
    scheduleSaveFlush();
  }

  function scheduleSaveFlush() {
    if (!persist.available) return;
    clearTimeout(persist.saveTimer);
    persist.saveTimer = setTimeout(function () {
      persist.saveTimer = 0;
      flushScheduled();
    }, SAVE_DELAY);
  }

  function flushScheduled() {
    if (persist.saveTimer) {
      clearTimeout(persist.saveTimer);
      persist.saveTimer = 0;
    }
    if (!persist.available) return persist.chain;
    const book = state.book;
    if (!book) {
      persist.chapters.clear();
      persist.bookDirty = false;
      persist.fullDirty = false;
      return persist.chain;
    }

    const ids = Array.from(persist.chapters);
    const full = persist.fullDirty;
    const needBook = persist.bookDirty || ids.length > 0;
    persist.chapters.clear();
    persist.bookDirty = false;
    persist.fullDirty = false;
    if (!full && !needBook) return persist.chain;

    return enqueue(function () {
      if (full) return ND.db.saveBook(book);
      return ids
        .reduce(function (chain, id) {
          return chain.then(function () {
            const chapter = book.chapters.find(function (item) {
              return item.id === id;
            });
            if (!chapter) return null;
            return ND.db.updateChapter(book.id, chapter);
          });
        }, Promise.resolve())
        .then(function () {
          if (needBook) return ND.db.updateBook(book);
          return null;
        });
    });
  }

  function cancelPendingWrites() {
    clearTimeout(persist.saveTimer);
    clearTimeout(persist.settingsTimer);
    persist.saveTimer = 0;
    persist.settingsTimer = 0;
    persist.chapters.clear();
    persist.bookDirty = false;
    persist.fullDirty = false;
  }

  function scheduleSettingsSave() {
    if (!persist.available) return;
    clearTimeout(persist.settingsTimer);
    persist.settingsTimer = setTimeout(function () {
      persist.settingsTimer = 0;
      flushSettings();
    }, SAVE_DELAY);
  }

  function flushSettings() {
    if (persist.settingsTimer) {
      clearTimeout(persist.settingsTimer);
      persist.settingsTimer = 0;
    }
    if (!persist.available || !state.book) return persist.chain;
    const payload = {
      lastBookId: state.book.id,
      lastChapterId: state.selectedId || "",
      lastView: state.view || "source",
      lastFilter: state.filter || "",
    };
    return enqueue(function () {
      return ND.db
        .setSetting("lastBookId", payload.lastBookId)
        .then(function () {
          return ND.db.setSetting("lastChapterId", payload.lastChapterId);
        })
        .then(function () {
          return ND.db.setSetting("lastView", payload.lastView);
        })
        .then(function () {
          return ND.db.setSetting("lastFilter", payload.lastFilter);
        });
    }, true);
  }

  function flushPendingWrites() {
    flushScheduled();
    flushSettings();
    return persist.chain;
  }

  function renderShelfStorage() {
    const node = $("shelfStorage");
    if (!node) return;
    ND.db.estimate().then(function (info) {
      if (!info || !info.supported) {
        node.textContent = "存储占用：不可用";
        return;
      }
      const usage = Number(info.usage || 0) / (1024 * 1024);
      const quota = Number(info.quota || 0) / (1024 * 1024 * 1024);
      let text = "存储占用：" + usage.toFixed(1) + " MB";
      if (quota) text += " / 浏览器配额 " + quota.toFixed(1) + " GB";
      node.textContent = text;
    });
  }

  async function renderShelf() {
    const listNode = $("shelfList");
    const clearButton = $("shelfClearButton");
    if (!listNode) return;

    if (!persist.available) {
      listNode.innerHTML =
        '<div class="empty">当前环境不支持持久化，导入的书刷新后会丢失。</div>';
      if (clearButton) clearButton.disabled = true;
      const storageNode = $("shelfStorage");
      if (storageNode) storageNode.textContent = "存储占用：不可用";
      return;
    }

    let books = [];
    try {
      books = await ND.db.listBooks();
      persist.ready = true;
      renderSaveStatus();
    } catch (error) {
      persistenceError(error);
      return;
    }

    if (!books.length) {
      listNode.innerHTML =
        '<div class="empty">书架为空。导入 TXT、ZIP 或文件夹后会自动保存。</div>';
    } else {
      const rows = books.slice(0, 20).map(function (book) {
        const stats = book.stats || {};
        const excluded = Number(stats.excluded || 0);
        const title = book.title || bookTitle(book.fileName);
        return (
          '<article class="shelf-row">' +
          '<div class="shelf-main">' +
          '<div class="shelf-title-row"><strong>' + ND.escapeHtml(title) + "</strong>" +
          '<span class="badge info">' + sourceLabel(book.source) + "</span></div>" +
          '<div class="shelf-meta">' + formatDateTime(book.updatedAt) + " · " +
          Number(stats.volumes || 0) + " 卷 · " +
          ND.formatCount(stats.chapters) + " 节 · 排除 " + excluded + " 条</div>" +
          "</div>" +
          '<div class="actions">' +
          '<button data-shelf-open="' + ND.escapeHtml(book.id) + '">打开</button>' +
          '<button class="danger" data-shelf-delete="' + ND.escapeHtml(book.id) +
          '" data-shelf-title="' + ND.escapeHtml(title) + '">删除</button>' +
          "</div></article>"
        );
      });
      if (books.length > 20) {
        rows.push(
          '<p class="hint">仅显示最近 20 本，共 ' + books.length + " 本；其余仍保存在浏览器中。</p>",
        );
      }
      listNode.innerHTML = rows.join("");

      listNode.querySelectorAll("[data-shelf-open]").forEach(function (button) {
        button.onclick = function () {
          openShelfBook(button.dataset.shelfOpen);
        };
      });
      listNode.querySelectorAll("[data-shelf-delete]").forEach(function (button) {
        button.onclick = function () {
          deleteShelfBook(button.dataset.shelfDelete, button.dataset.shelfTitle);
        };
      });
    }

    if (clearButton) clearButton.disabled = !books.length;
    renderShelfStorage();
  }

  function applyStoredBook(book, chapterId, view, filter) {
    cancelPendingWrites();
    resetCleanState();
    state.book = book;
    state.fileName = book.fileName || "";
    state.filter = filter || "";
    if ($("tocFilter")) $("tocFilter").value = state.filter;

    const wanted = book.chapters.find(function (chapter) {
      return chapter.id === chapterId;
    });
    const first = firstContentChapter() || book.chapters[0];
    state.selectedId = wanted ? wanted.id : first ? first.id : "";

    state.collapsed = new Set();
    if (book.chapters.length > 400) {
      book.volumes.forEach(function (volume) {
        state.collapsed.add(volume.id);
      });
      const selected = book.chapters.find(function (chapter) {
        return chapter.id === state.selectedId;
      });
      if (selected) state.collapsed.delete(selected.volumeId);
    }

    renderAll();
    switchView(validView(view));
    renderShelf();
    notifyBookChanged();
    scheduleSettingsSave();
  }

  async function openShelfBook(id) {
    if (!id || !persist.available) return;
    try {
      await flushPendingWrites();
      const book = await ND.db.loadBook(id);
      if (!book) {
        showToast("书籍不存在，可能已被删除");
        renderShelf();
        return;
      }
      const lastBookId = await ND.db.getSetting("lastBookId", "");
      const chapterId = lastBookId === id ? await ND.db.getSetting("lastChapterId", "") : "";
      applyStoredBook(book, chapterId, "toc", "");
      showToast("已打开《" + (book.title || bookTitle(book.fileName)) + "》");
    } catch (error) {
      persistenceError(error);
    }
  }

  async function deleteShelfBook(id, title) {
    if (!id || !persist.available) return;
    const name = title || "这本书";
    if (!window.confirm("确定从书架删除《" + name + "》？删除后无法恢复。")) return;
    const isCurrent = !!(state.book && state.book.id === id);
    try {
      if (isCurrent) {
        cancelPendingWrites();
        await persist.chain;
      }
      await ND.db.deleteBook(id);
      if (isCurrent) {
        resetBookState();
        await ND.db.setSetting("lastBookId", "");
        await ND.db.setSetting("lastChapterId", "");
      }
      renderShelf();
      showToast("已从书架删除：" + name);
    } catch (error) {
      persistenceError(error);
    }
  }

  async function clearShelf() {
    if (!persist.available) return;
    if (!window.confirm("确定清空书架？所有已保存的书与阅读进度都会被删除，且无法恢复。")) return;
    try {
      cancelPendingWrites();
      await persist.chain;
      await ND.db.clearAll();
      resetBookState();
      renderShelf();
      showToast("书架已清空");
    } catch (error) {
      persistenceError(error);
    }
  }

  function persistImportedBook(book, source) {
    if (!persist.available || !book) return Promise.resolve();
    return enqueue(async function () {
      if (!book.id) book.id = await ND.db.newId("book");
      book.title = book.title || bookTitle(book.fileName);
      book.source = source || book.source || "txt";
      if (!book.createdAt) book.createdAt = new Date().toISOString();
      await ND.db.saveBook(book);
      await ND.db.setSetting("lastBookId", book.id);
      await ND.db.setSetting(
        "lastChapterId",
        state.book === book ? state.selectedId || "" : "",
      );
      await ND.db.setSetting("lastView", state.view);
      await ND.db.setSetting("lastFilter", state.filter || "");
      renderShelf();
      showToast("已保存到书架");
    });
  }

  function resetBookState() {
    cancelPendingWrites();
    resetCleanState();
    state.book = null;
    state.fileName = "";
    state.selectedId = "";
    state.filter = "";
    state.collapsed = new Set();
    if ($("tocFilter")) $("tocFilter").value = "";
    renderAll();
    notifyBookChanged();
  }

  async function restoreSession() {
    try {
      await ND.db.open();
      persist.ready = true;
      persist.available = true;
      renderSaveStatus();
      if (typeof ND.db.isLegacy === "function" && ND.db.isLegacy()) {
        setTimeout(function () {
          showToast("旧书库迁移未完成，本次使用旧数据；下次启动会自动重试");
        }, 1200);
      }
    } catch (error) {
      persistenceError(error);
      return;
    }

    let lastBookId = "";
    try {
      lastBookId = await ND.db.getSetting("lastBookId", "");
    } catch (error) {
      persistenceError(error);
      return;
    }
    if (!lastBookId) {
      renderShelf();
      return;
    }

    try {
      const book = await ND.db.loadBook(lastBookId);
      if (!book) {
        await ND.db.setSetting("lastBookId", "");
        renderShelf();
        return;
      }
      const chapterId = await ND.db.getSetting("lastChapterId", "");
      const view = await ND.db.getSetting("lastView", "source");
      const filter = await ND.db.getSetting("lastFilter", "");
      applyStoredBook(book, chapterId, view, filter);
      showToast("已恢复上次会话");
    } catch (error) {
      persistenceError(error);
    }
  }

  function defaultRules() {
    return {
      volumePattern: ND.DEFAULT_RULES.volumePattern,
      chapterPattern: ND.DEFAULT_RULES.chapterPattern,
      extraKeywords: "",
    };
  }

  function loadRules() {
    const saved = loadJSON(RULES_KEY, {});
    return {
      volumePattern: saved.volumePattern || ND.DEFAULT_RULES.volumePattern,
      chapterPattern: saved.chapterPattern || ND.DEFAULT_RULES.chapterPattern,
      extraKeywords: saved.extraKeywords || "",
    };
  }

  function readRules() {
    return {
      volumePattern: $("volumePatternInput").value.trim() || ND.DEFAULT_RULES.volumePattern,
      chapterPattern: $("chapterPatternInput").value.trim() || ND.DEFAULT_RULES.chapterPattern,
      extraKeywords: $("extraKeywordsInput").value.trim(),
    };
  }

  function saveRules(rules) {
    saveJSON(RULES_KEY, rules);
  }

  function applyRules(rules) {
    $("volumePatternInput").value = rules.volumePattern;
    $("chapterPatternInput").value = rules.chapterPattern;
    $("extraKeywordsInput").value = rules.extraKeywords;
  }

  function allChapters() {
    return state.book ? state.book.chapters : [];
  }

  function selectedChapter() {
    return allChapters().find(function (chapter) {
      return chapter.id === state.selectedId;
    });
  }

  function firstContentChapter() {
    return allChapters().find(function (chapter) {
      return chapter.type === "chapter" || chapter.type === "preface";
    });
  }

  function chapterPlaceholder(chapter) {
    if (chapter.type === "volumeNote") return "卷首";
    if (chapter.type === "notice") return "通知";
    if (chapter.type === "preface") return "序";
    return chapter.globalIndex != null ? String(chapter.globalIndex) : "·";
  }

  function chapterBadges(chapter) {
    const badges = [];
    if (chapter.type === "notice") badges.push('<span class="badge warn">通知</span>');
    if (chapter.type === "volumeNote") badges.push('<span class="badge info">卷首</span>');
    if (chapter.excluded) badges.push('<span class="badge danger">已排除</span>');
    else if (chapter.junkType === "suspect") badges.push('<span class="badge warn">疑似</span>');
    return badges.join("");
  }

  function renderSource() {
    const book = state.book;
    $("statChars").textContent = book ? ND.formatCount(book.stats.chars) : "0";
    $("statVolumes").textContent = book ? ND.formatCount(book.stats.volumes) : "0";
    $("statChapters").textContent = book ? ND.formatCount(book.stats.chapters) : "0";
    $("statJunk").textContent = book
      ? ND.formatCount(book.chapters.filter(function (chapter) { return chapter.excluded; }).length)
      : "0";
    $("sourcePreview").value = book ? book.rawText.slice(0, 3000) : "";
    renderSidebar();
  }

  function renderSidebar() {
    const book = state.book;
    if (!book) {
      $("sidebarSummary").textContent = "未导入文件";
      return;
    }
    const excluded = book.chapters.filter(function (chapter) { return chapter.excluded; }).length;
    $("sidebarSummary").innerHTML =
      "<strong>" + ND.escapeHtml(book.fileName) + "</strong><br />" +
      book.stats.volumes + " 卷 · " + ND.formatCount(book.stats.chapters) + " 节 · 排除 " + excluded + " 条";
  }

  function cleanCandidates() {
    if (!state.book) return [];
    return state.book.chapters.filter(function (chapter) {
      return chapter.junkType !== "normal" || chapter.excluded;
    });
  }

  function renderClean() {
    const book = state.book;
    const list = $("cleanList");
    if (!book) {
      $("cleanSummary").textContent = "尚未导入文件。";
      list.innerHTML = '<div class="empty">导入并切分后显示清洗结果。</div>';
      resetCleanState();
      updateCleanControls();
      renderCleanPreview();
      return;
    }

    const candidates = cleanCandidates();
    const visible = new Set(candidates.map(function (chapter) { return chapter.id; }));
    state.cleanSelection.forEach(function (id) {
      if (!visible.has(id)) state.cleanSelection.delete(id);
    });
    if (state.cleanAnchorId && !visible.has(state.cleanAnchorId)) state.cleanAnchorId = "";
    if (state.cleanPreviewId && !visible.has(state.cleanPreviewId)) state.cleanPreviewId = "";

    const junk = candidates.filter(function (chapter) { return chapter.excluded; }).length;
    const suspect = candidates.filter(function (chapter) { return !chapter.excluded; }).length;

    $("cleanSummary").innerHTML =
      '<span class="badge danger">已排除 ' + junk + " 条</span>" +
      '<span class="badge warn">待确认 ' + suspect + " 条</span>" +
      '<span class="badge info">通知段落 ' + book.stats.notices + " 条</span>";

    if (!candidates.length) {
      list.innerHTML = '<div class="empty">没有检测到可疑章节。</div>';
      state.cleanSelection.clear();
      state.cleanAnchorId = "";
      state.cleanPreviewId = "";
      updateCleanControls();
      renderCleanPreview();
      return;
    }

    const scrollTop = list.scrollTop;
    list.innerHTML = candidates
      .map(function (chapter, index) {
        const reasons = (chapter.reasons || []).join("；") || "手动标记";
        const active = chapter.id === state.cleanPreviewId ? " active" : "";
        const picked = state.cleanSelection.has(chapter.id) ? " picked" : "";
        return (
          '<div class="clean-row' + active + picked + '" data-id="' + chapter.id +
          '" data-index="' + index + '">' +
          '<input type="checkbox" data-exclude="' + chapter.id + '"' + (chapter.excluded ? " checked" : "") + " />" +
          '<div class="clean-main">' +
          '<div class="clean-title"><button class="link-button" data-open="' + chapter.id + '">' +
          ND.escapeHtml(chapter.rawTitle || chapter.title) + "</button>" +
          chapterBadges(chapter) + "</div>" +
          '<div class="clean-reasons">' + ND.escapeHtml(reasons) + " · " +
          ND.formatCount((chapter.body || "").length) + " 字</div>" +
          "</div>" +
          '<div class="clean-score">' + (chapter.junkScore || 0) + "</div>" +
          "</div>"
        );
      })
      .join("");
    list.scrollTop = scrollTop;

    updateCleanControls();
    renderCleanPreview();
  }

  function updateCleanRowClasses() {
    const list = $("cleanList");
    if (!list) return;
    list.querySelectorAll(".clean-row").forEach(function (row) {
      row.classList.toggle("picked", state.cleanSelection.has(row.dataset.id));
      row.classList.toggle("active", row.dataset.id === state.cleanPreviewId);
    });
  }

  function updateCleanControls() {
    const candidates = cleanCandidates();
    const total = candidates.length;
    const picked = candidates.filter(function (chapter) {
      return state.cleanSelection.has(chapter.id);
    }).length;
    $("cleanSelectionCount").textContent = "已选 " + state.cleanSelection.size + " 条";
    $("cleanExcludeSelected").disabled = state.cleanSelection.size === 0;
    $("cleanRestoreSelected").disabled = state.cleanSelection.size === 0;
    $("cleanClearSelection").disabled = state.cleanSelection.size === 0;
    const selectAll = $("cleanSelectAll");
    selectAll.disabled = total === 0;
    selectAll.checked = total > 0 && picked === total;
    selectAll.indeterminate = picked > 0 && picked < total;
  }

  function renderCleanPreview() {
    const titleNode = $("cleanPreviewTitle");
    const metaNode = $("cleanPreviewMeta");
    const bodyNode = $("cleanPreviewBody");
    const toggleButton = $("cleanPreviewToggleExclude");
    const openButton = $("cleanPreviewOpenReader");
    if (!titleNode || !metaNode || !bodyNode) return;

    const chapter = allChapters().find(function (item) {
      return item.id === state.cleanPreviewId;
    });
    if (!chapter) {
      titleNode.textContent = "未选择章节";
      metaNode.textContent = "点击左侧章节查看正文。";
      bodyNode.textContent = "";
      bodyNode.dataset.previewId = "";
      toggleButton.textContent = "排除本章";
      toggleButton.disabled = true;
      openButton.disabled = true;
      return;
    }

    const volume = state.book.volumes.find(function (item) {
      return item.id === chapter.volumeId;
    });
    const parts = [];
    if (volume) parts.push(volume.rawTitle);
    if (chapter.globalIndex != null) parts.push("全书第 " + chapter.globalIndex + " 节");
    if (chapter.localIndex != null) parts.push("卷内第 " + chapter.localIndex + " 节");
    parts.push(ND.formatCount((chapter.body || "").length) + " 字");
    parts.push("分类分 " + (chapter.junkScore || 0));
    parts.push(chapter.excluded ? "已排除" : "未排除");
    const reasons = (chapter.reasons || []).join("；");
    if (reasons) parts.push("原因：" + reasons);
    titleNode.textContent = chapter.title || chapter.rawTitle;
    metaNode.textContent = parts.join(" · ");

    bodyNode.textContent = chapter.body || "";
    if (bodyNode.dataset.previewId !== chapter.id) bodyNode.scrollTop = 0;
    bodyNode.dataset.previewId = chapter.id;

    toggleButton.textContent = chapter.excluded ? "恢复本章" : "排除本章";
    toggleButton.classList.toggle("danger", !chapter.excluded);
    toggleButton.disabled = false;
    openButton.disabled = false;
  }

  function setCleanPreview(id) {
    state.cleanPreviewId = id || "";
    updateCleanRowClasses();
    renderCleanPreview();
  }

  function applyCleanRange(fromIndex, toIndex, append, base) {
    const candidates = cleanCandidates();
    const start = Math.max(0, Math.min(fromIndex, toIndex));
    const end = Math.min(candidates.length - 1, Math.max(fromIndex, toIndex));
    state.cleanSelection.clear();
    if (append && base) {
      base.forEach(function (id) { state.cleanSelection.add(id); });
    }
    for (let index = start; index <= end; index += 1) {
      state.cleanSelection.add(candidates[index].id);
    }
    updateCleanRowClasses();
    updateCleanControls();
  }

  function clearCleanSelection() {
    state.cleanSelection.clear();
    state.cleanAnchorId = "";
    updateCleanRowClasses();
    updateCleanControls();
  }

  function resetCleanState() {
    state.cleanSelection.clear();
    state.cleanAnchorId = "";
    state.cleanPreviewId = "";
    state.cleanDragging = false;
    cleanDrag.armed = false;
    cleanDrag.dragged = false;
    cleanDrag.base = null;
    document.body.classList.remove("selecting");
  }

  function selectedCleanChapters() {
    const map = new Map();
    cleanCandidates().forEach(function (chapter) {
      map.set(chapter.id, chapter);
    });
    return Array.from(state.cleanSelection)
      .map(function (id) { return map.get(id); })
      .filter(Boolean);
  }

  function setCleanSelectedExcluded(excluded) {
    const chapters = selectedCleanChapters();
    if (!chapters.length) {
      showToast("请先选择章节");
      return;
    }
    chapters.forEach(function (chapter) {
      chapter.excluded = excluded;
      chapter.manual = true;
      queueChapter(chapter);
    });
    renderAll();
    showToast((excluded ? "已排除 " : "已恢复 ") + chapters.length + " 条");
  }

  function toggleCleanPreviewExclude() {
    const chapter = allChapters().find(function (item) {
      return item.id === state.cleanPreviewId;
    });
    if (!chapter) return;
    chapter.excluded = !chapter.excluded;
    chapter.manual = true;
    queueChapter(chapter);
    renderAll();
    showToast(chapter.excluded ? "已排除，导出时跳过" : "已恢复");
  }

  function openCleanPreviewReader() {
    if (state.cleanPreviewId) selectChapter(state.cleanPreviewId);
  }

  function onCleanMouseDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest("input, button, label, a")) return;
    const list = $("cleanList");
    const row = event.target.closest(".clean-row");
    if (!list || !row || !list.contains(row)) return;
    const index = Number(row.dataset.index);
    if (!Number.isFinite(index)) return;
    if (!event.shiftKey) state.cleanAnchorId = row.dataset.id;
    state.cleanDragging = false;
    cleanDrag = {
      armed: true,
      dragged: false,
      startIndex: index,
      lastIndex: index,
      append: !!(event.ctrlKey || event.metaKey),
      base: event.ctrlKey || event.metaKey ? new Set(state.cleanSelection) : null,
    };
    event.preventDefault();
  }

  function onCleanMouseOver(event) {
    if (!cleanDrag.armed) return;
    if (!(event.buttons & 1)) return;
    const row = event.target.closest(".clean-row");
    if (!row) return;
    const index = Number(row.dataset.index);
    if (!Number.isFinite(index)) return;
    if (!cleanDrag.dragged && index === cleanDrag.startIndex) return;
    if (cleanDrag.dragged && index === cleanDrag.lastIndex) return;
    cleanDrag.dragged = true;
    state.cleanDragging = true;
    document.body.classList.add("selecting");
    applyCleanRange(cleanDrag.startIndex, index, cleanDrag.append, cleanDrag.base);
    cleanDrag.lastIndex = index;
  }

  function onCleanMouseUp(event) {
    if (!cleanDrag.armed) return;
    const dragged = cleanDrag.dragged;
    const append = cleanDrag.append;
    const base = cleanDrag.base;
    cleanDrag.armed = false;
    cleanDrag.dragged = false;
    cleanDrag.base = null;
    if (state.cleanDragging) {
      state.cleanDragging = false;
      document.body.classList.remove("selecting");
    }
    if (dragged) return;

    const row = event.target.closest ? event.target.closest(".clean-row") : null;
    if (!row) return;
    const id = row.dataset.id;
    const index = Number(row.dataset.index);
    if (!Number.isFinite(index)) return;

    if (event.shiftKey) {
      const candidates = cleanCandidates();
      let anchorIndex = candidates.findIndex(function (chapter) {
        return chapter.id === state.cleanAnchorId;
      });
      if (anchorIndex < 0) anchorIndex = index;
      applyCleanRange(anchorIndex, index, append, base);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (state.cleanSelection.has(id)) state.cleanSelection.delete(id);
      else state.cleanSelection.add(id);
      state.cleanAnchorId = id;
      updateCleanRowClasses();
      updateCleanControls();
      return;
    }

    state.cleanAnchorId = id;
    setCleanPreview(id);
  }

  function toggleCleanSelectAll(checked) {
    state.cleanSelection.clear();
    if (checked) {
      cleanCandidates().forEach(function (chapter) {
        state.cleanSelection.add(chapter.id);
      });
    }
    updateCleanRowClasses();
    updateCleanControls();
  }

  function renderToc() {
    const book = state.book;
    const container = $("tocList");
    if (!book) {
      container.innerHTML = '<div class="empty">尚未导入文件。</div>';
      return;
    }

    const filter = state.filter.trim().toLowerCase();
    let html = "";

    for (const volume of book.volumes) {
      const chapters = volume.chapters.filter(function (chapter) {
        if (!filter) return true;
        return (chapter.title || "").toLowerCase().indexOf(filter) !== -1;
      });
      if (!chapters.length) continue;
      const collapsed = state.collapsed.has(volume.id) && !filter;
      const chars = chapters.reduce(function (sum, chapter) {
        return sum + (chapter.body || "").length;
      }, 0);

      html += '<article class="volume' + (collapsed ? " collapsed" : "") + '" data-volume="' + volume.id + '">';
      html += '<div class="volume-head" data-toggle="' + volume.id + '">';
      html += '<span class="volume-arrow">' + (collapsed ? "▸" : "▾") + "</span>";
      html += '<div class="volume-title"><h3>' + ND.escapeHtml(volume.rawTitle) + "</h3>";
      html += '<div class="volume-meta">' + chapters.length + " 章 · " + ND.formatCount(chars) + " 字</div></div>";
      html += "</div>";
      html += '<div class="chapter-list">';

      for (const chapter of chapters) {
        const active = chapter.id === state.selectedId ? " selected" : "";
        const excluded = chapter.excluded ? " excluded" : "";
        html +=
          '<div class="chapter-row' + active + excluded + '" data-chapter="' + chapter.id + '">' +
          '<span class="chapter-num">' + ND.escapeHtml(chapterPlaceholder(chapter)) + "</span>" +
          '<span class="chapter-name">' + ND.escapeHtml(chapter.title || chapter.rawTitle) + "</span>" +
          '<span class="chapter-meta">' + ND.formatCount((chapter.body || "").length) + " 字 " + chapterBadges(chapter) + "</span>" +
          "</div>";
      }

      html += "</div></article>";
    }

    container.innerHTML = html || '<div class="empty">没有匹配的章节。</div>';

    container.querySelectorAll("[data-toggle]").forEach(function (head) {
      head.onclick = function () {
        const id = head.dataset.toggle;
        if (state.collapsed.has(id)) state.collapsed.delete(id);
        else state.collapsed.add(id);
        renderToc();
      };
    });

    container.querySelectorAll("[data-chapter]").forEach(function (row) {
      row.onclick = function () {
        selectChapter(row.dataset.chapter);
      };
    });
  }

  function renderReader() {
    const chapter = selectedChapter();
    const body = $("readerBody");
    const titleInput = $("chapterTitleInput");
    const toggleButton = $("toggleExcludeButton");

    if (!chapter) {
      $("readerTitle").textContent = "未选择章节";
      $("readerMeta").textContent = "从卷目录选择章节。";
      titleInput.value = "";
      body.textContent = "";
      toggleButton.textContent = "排除本章";
      toggleButton.disabled = true;
      $("prevChapterButton").disabled = true;
      $("nextChapterButton").disabled = true;
      $("exportChapterButton").disabled = true;
      return;
    }

    const volume = state.book.volumes.find(function (item) { return item.id === chapter.volumeId; });
    $("readerTitle").textContent = chapter.title || chapter.rawTitle;
    $("readerMeta").textContent =
      (volume ? volume.rawTitle : "") +
      (chapter.globalIndex != null ? " · 全书第 " + chapter.globalIndex + " 节" : " · " + chapterPlaceholder(chapter)) +
      (chapter.localIndex != null ? " · 卷内第 " + chapter.localIndex + " 节" : "") +
      " · " + ND.formatCount((chapter.body || "").length) + " 字" +
      (chapter.excluded ? " · 已排除" : "");

    if (document.activeElement !== titleInput) titleInput.value = chapter.title || chapter.rawTitle;
    body.textContent = chapter.body || "";
    body.scrollTop = 0;

    toggleButton.textContent = chapter.excluded ? "恢复本章" : "排除本章";
    toggleButton.disabled = false;
    toggleButton.classList.toggle("danger", !chapter.excluded);

    const position = allChapters().findIndex(function (item) { return item.id === chapter.id; });
    $("prevChapterButton").disabled = position <= 0;
    $("nextChapterButton").disabled = position < 0 || position >= allChapters().length - 1;
    $("exportChapterButton").disabled = false;
  }

  function renderExportTargetHint() {
    const node = $("exportTargetHint");
    if (!node) return;
    const mode = ND.exportTarget.mode();
    const bookName = state.book ? bookTitle(state.book.fileName) : "<书名>";
    const relative = "export/" + bookName + "/";

    node.classList.remove("warn", "danger");
    if (mode === "server") {
      const root = (exportTarget.result && exportTarget.result.root) || "";
      const base = root ? String(root).replace(/\\/g, "/").replace(/\/+$/, "") : "";
      node.textContent = "服务模式：" + (base ? base + "/" : "") + relative;
      return;
    }
    if (mode === "picker") {
      node.textContent =
        "首次使用请选择项目根目录（包含 index.html），之后默认写入 " + relative;
      return;
    }
    if (mode === "unsupported") {
      node.textContent = "当前环境不支持写入目录，请用 start.bat 启动或导出 ZIP";
      node.classList.add("danger");
      return;
    }
    node.textContent = "正在检测导出目标…";
    node.classList.add("warn");
  }

  function renderExportSummary() {
    renderExportTargetHint();
    const book = state.book;
    if (!book) {
      $("exportSummary").textContent = "尚未导入文件。";
      return;
    }
    const options = currentOptions();
    const counts = ND.countSelection(book, options);
    $("exportSummary").textContent =
      "将导出 " + ND.formatCount(counts.total) + " 个章节文件；已排除 " +
      ND.formatCount(counts.excluded) + " 条；共 " +
      book.stats.volumes + " 卷 / " + ND.formatCount(book.stats.chapters) + " 节。";
  }

  function renderAll() {
    renderSource();
    renderClean();
    renderToc();
    renderReader();
    renderExportSummary();
  }

  function pluginTemplateValues() {
    return {
      volumeFolder: $("tplVolumeFolder").value,
      chapterFile: $("tplChapterFile").value,
      header: $("tplHeader").value,
    };
  }

  function applyTemplateInputs(templates) {
    $("tplVolumeFolder").value = templates.volumeFolder;
    $("tplChapterFile").value = templates.chapterFile;
    $("tplHeader").value = templates.header;
  }

  function renderTemplatePreview() {
    const preview = $("templatePreview");
    if (!preview) return;
    if (!state.book) {
      preview.textContent = "导入素材后显示第一个内容章节的路径预览。";
      return;
    }
    try {
      const result = ND.buildTemplatePreview(state.book, currentOptions(), pluginTemplateValues());
      if (!result) {
        preview.textContent = "当前没有可导出的内容章节。";
        return;
      }
      preview.textContent =
        "预览：" + result.path + "\n内容头：" +
        (result.header ? result.header : "（空，只输出正文）");
    } catch (error) {
      preview.textContent = "预览失败：" + ((error && error.message) || "未知错误");
    }
  }

  function pluginViewKey(pluginId, viewId) {
    return "plugin:" + pluginId + ":" + viewId;
  }

  function pluginContext(view) {
    return {
      pluginId: view.pluginId,
      getBook: function () {
        return state.book;
      },
      getSelectedChapter: function () {
        return selectedChapter();
      },
      toast: showToast,
      switchView: switchView,
      refresh: renderAll,
      storage: ND.plugins.storage(view.pluginId),
    };
  }

  function renderPluginViewError(entry, message) {
    const text = String(message || "未知错误");
    entry.panel.innerHTML = "";
    const node = document.createElement("p");
    node.className = "plugin-error";
    node.textContent = "插件视图加载失败：" + text;
    entry.panel.appendChild(node);
    showToast("插件视图加载失败：" + text);
  }

  function showPluginView(key) {
    const entry = pluginViewRegistry[key];
    if (!entry) return;

    if (!entry.mounted) {
      entry.mounted = true;
      try {
        const result = entry.view.mount(entry.panel, entry.ctx);
        // mount 允许返回 Promise；异步失败同样落到面板与 toast。
        if (result && typeof result.then === "function") {
          result.catch(function (error) {
            renderPluginViewError(entry, error && error.message ? error.message : String(error));
          });
        }
      } catch (error) {
        renderPluginViewError(entry, error && error.message ? error.message : String(error));
      }
      return;
    }

    if (typeof entry.view.onShow === "function") {
      try {
        const result = entry.view.onShow(entry.ctx);
        if (result && typeof result.then === "function") {
          result.catch(function (error) {
            showToast(
              "插件视图刷新失败：" + (error && error.message ? error.message : String(error)),
            );
          });
        }
      } catch (error) {
        showToast(
          "插件视图刷新失败：" + (error && error.message ? error.message : String(error)),
        );
      }
    }
  }

  // 每次插件加载/开关变化后重建动态导航与视图容器。
  function renderPluginViews() {
    const nav = document.querySelector(".nav");
    const content = document.querySelector(".content");
    if (!nav || !content) return;

    document.querySelectorAll('[data-plugin-view="1"]').forEach(function (node) {
      node.remove();
    });

    const previous = state.view;
    pluginViewRegistry = Object.create(null);

    ND.plugins.views().forEach(function (view) {
      const key = pluginViewKey(view.pluginId, view.id);

      const button = document.createElement("button");
      button.setAttribute("data-plugin-view", "1");
      button.dataset.view = key;
      button.textContent = view.label;
      button.onclick = function () {
        switchView(key);
      };
      nav.appendChild(button);

      const section = document.createElement("section");
      section.className = "view";
      section.setAttribute("data-plugin-view", "1");
      section.dataset.view = key;
      const panel = document.createElement("div");
      panel.className = "panel plugin-view";
      section.appendChild(panel);
      content.appendChild(section);

      pluginViewRegistry[key] = {
        view: view,
        panel: panel,
        ctx: null,
        mounted: false,
      };
      pluginViewRegistry[key].ctx = pluginContext(view);
    });

    if (isPluginView(previous)) {
      // 视图还在就重新激活；插件被停用/移除时回到插件页。
      if (pluginViewRegistry[previous]) switchView(previous);
      else switchView("plugins");
    }
  }

  function renderPlugins() {
    const statusNode = $("pluginStatus");
    const listNode = $("pluginList");
    if (!statusNode || !listNode) return;

    const status = ND.plugins.status();
    const plugins = ND.plugins.list();
    const errorCount = plugins.filter(function (plugin) { return !!plugin.error; }).length;

    if (status.loading) {
      statusNode.textContent = "正在加载插件清单与脚本…";
    } else if (!status.indexLoaded && status.indexError) {
      statusNode.innerHTML =
        '<span class="badge danger">清单未加载</span>' +
        '<span>' + ND.escapeHtml(status.indexError) + "。运行 " +
        "<code>powershell -File tools/build-plugins.ps1</code> 生成清单后点“刷新插件”。</span>";
    } else {
      statusNode.innerHTML =
        '<span class="badge info">已加载 ' + plugins.length + " 个</span>" +
        (errorCount
          ? '<span class="badge danger">错误 ' + errorCount + " 个</span>"
          : '<span class="badge">无错误</span>') +
        '<span>清单：<code>' + ND.escapeHtml(status.manifestPath) + "</code></span>" +
        '<span>已启用 ' + plugins.filter(function (plugin) { return plugin.enabled; }).length + " 个</span>";
    }

    if (!plugins.length) {
      listNode.innerHTML =
        '<div class="empty">暂无已加载插件。把插件目录放进 <code>plugins/</code>，' +
        "运行 <code>powershell -File tools/build-plugins.ps1</code> 生成清单后刷新。</div>";
      renderTemplatePreview();
      return;
    }

    listNode.innerHTML = plugins
      .map(function (plugin) {
        const badges = [];
        if (!plugin.compatible) badges.push('<span class="badge danger">不兼容</span>');
        if (!plugin.registered) badges.push('<span class="badge warn">未注册</span>');
        if (plugin.manifest) badges.push('<span class="badge info">清单</span>');
        const disabled = !plugin.compatible || !plugin.registered ? " disabled" : "";
        return (
          '<article class="plugin-card">' +
          '<div class="plugin-card-head">' +
          "<div>" +
          "<h3>" + ND.escapeHtml(plugin.name) + badges.join("") + "</h3>" +
          '<div class="plugin-meta">' + ND.escapeHtml(plugin.id) + " · v" +
          ND.escapeHtml(plugin.version) + " · priority " + plugin.priority +
          " · api " + ND.escapeHtml(String(plugin.apiVersion == null ? "?" : plugin.apiVersion)) + "</div>" +
          "</div>" +
          '<label class="plugin-switch"><input type="checkbox" data-plugin-toggle="' +
          ND.escapeHtml(plugin.id) + '"' + (plugin.enabled ? " checked" : "") + disabled + " /> 启用</label>" +
          "</div>" +
          '<p class="plugin-desc">' + (ND.escapeHtml(plugin.description) || "无描述") + "</p>" +
          '<div class="plugin-hooks">hooks：' +
          (plugin.hooks.length ? ND.escapeHtml(plugin.hooks.join(", ")) : "无") + "</div>" +
          (plugin.error ? '<div class="plugin-error">' + ND.escapeHtml(plugin.error) + "</div>" : "") +
          "</article>"
        );
      })
      .join("");

    listNode.querySelectorAll("[data-plugin-toggle]").forEach(function (input) {
      input.onchange = function () {
        const id = input.dataset.pluginToggle;
        if (!ND.plugins.setEnabled(id, input.checked)) {
          showToast("插件未加载，无法切换");
        } else {
          showToast(input.checked ? "已启用插件：" + id : "已停用插件：" + id);
        }
        renderPlugins();
        renderPluginViews();
      };
    });

    renderTemplatePreview();
  }

  async function refreshPlugins() {
    const button = $("pluginRefreshButton");
    button.disabled = true;
    try {
      await ND.plugins.load();
      renderPlugins();
      renderPluginViews();
      showToast("插件已刷新");
    } catch (error) {
      showToast("插件加载失败：" + ((error && error.message) || "未知错误"));
    } finally {
      button.disabled = false;
    }
  }

  function saveTemplates() {
    ND.plugins.setTemplates(pluginTemplateValues());
    renderTemplatePreview();
    showToast("导出模板已保存");
  }

  function resetTemplates() {
    applyTemplateInputs(ND.plugins.setTemplates(ND.plugins.defaultTemplates()));
    renderTemplatePreview();
    showToast("已恢复默认导出模板");
  }

  function switchView(viewName) {
    const name = typeof viewName === "string" ? viewName : "source";
    if (isPluginView(name) && !pluginViewRegistry[name]) {
      // 插件已停用/刷新且视图不存在：回到插件页。
      state.view = "plugins";
      switchView("plugins");
      return;
    }
    state.view = name;
    document.querySelectorAll(".view").forEach(function (view) {
      view.classList.toggle("active", view.dataset.view === name);
    });
    document.querySelectorAll(".nav button").forEach(function (button) {
      button.classList.toggle("active", button.dataset.view === name);
    });
    if (isPluginView(name)) {
      showPluginView(name);
    } else {
      if (name === "reader") renderReader();
      if (name === "export") renderExportSummary();
      if (name === "plugins") renderPlugins();
    }
    scheduleSettingsSave();
  }

  function selectChapter(id) {
    state.selectedId = id;
    switchView("reader");
    renderReader();
    renderToc();
    notifyChapterChanged();
    scheduleSettingsSave();
  }

  function goRelative(step) {
    const list = allChapters();
    const position = list.findIndex(function (chapter) { return chapter.id === state.selectedId; });
    const target = list[position + step];
    if (target) selectChapter(target.id);
  }

  function rebuildBook(text) {
    resetCleanState();
    const rules = readRules();
    saveRules(rules);
    const book = ND.splitBook(text, rules);
    book.fileName = state.fileName;
    ND.classifyBook(book, { extraKeywords: rules.extraKeywords });
    state.book = book;
    const first = firstContentChapter() || book.chapters[0];
    state.selectedId = first ? first.id : "";
    if (first && first.type === "chapter") state.selectedId = first.id;
    if (book.chapters.length > 400) {
      state.collapsed = new Set(book.volumes.map(function (volume) { return volume.id; }));
      if (first) state.collapsed.delete(first.volumeId);
    }
    renderAll();
    return book;
  }

  function importEntries(entries, source) {
    try {
      const book = ND.importFromEntries(entries);
      applyImportedBook(book, source);
    } catch (error) {
      showToast(error.message || "导入失败");
    }
  }

  function applyImportedBook(book, source) {
    cancelPendingWrites();
    resetCleanState();
    state.book = book;
    state.fileName = book.fileName;
    state.filter = "";
    if ($("tocFilter")) $("tocFilter").value = "";
    state.collapsed = new Set();
    book.title = book.title || bookTitle(book.fileName);
    book.source = source || book.source || "txt";
    const first = firstContentChapter() || book.chapters[0];
    state.selectedId = first ? first.id : "";
    if (book.chapters.length > 400) {
      book.volumes.forEach(function (volume) {
        state.collapsed.add(volume.id);
      });
      if (first) state.collapsed.delete(first.volumeId);
    }
    renderAll();
    notifyBookChanged();

    const excluded = book.chapters.filter(function (chapter) { return chapter.excluded; }).length;
    let message =
      "已从导出目录还原：" + book.stats.volumes + " 卷 / " + book.stats.chapters +
      " 节 / 排除 " + excluded + " 条";
    if (book.missingFiles) message += "；缺失 " + book.missingFiles + " 个文件已跳过";
    showToast(message);
    persistImportedBook(book, book.source);
  }

  async function importFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    event.target.value = "";
    try {
      await flushPendingWrites();
      const buffer = await file.arrayBuffer();
      if (/\.zip$/i.test(file.name)) {
        const entries = [];
        (await ND.readZip(buffer)).forEach(function (bytes, path) {
          entries.push({ path: path, bytes: bytes });
        });
        importEntries(entries, "zip");
        return;
      }

      let text = new TextDecoder("utf-8").decode(buffer);
      const broken = (text.match(/\uFFFD/g) || []).length;
      if (broken > 20 && broken / Math.max(1, text.length) > 0.0005) {
        try {
          text = new TextDecoder("gb18030").decode(buffer);
        } catch (error) {
          return;
        }
      }
      state.fileName = file.name;
      const book = rebuildBook(ND.normalizeText(text));
      book.title = bookTitle(book.fileName);
      book.source = "txt";
      notifyBookChanged();
      showToast("已切分：" + book.stats.volumes + " 卷 / " + book.stats.chapters + " 节，排除 " +
        book.chapters.filter(function (chapter) { return chapter.excluded; }).length + " 条");
      persistImportedBook(book, "txt");
    } catch (error) {
      showToast(error.message || "导入失败");
    }
  }

  async function importFolder(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    const selected = files.filter(function (file) {
      const path = file.webkitRelativePath || file.name;
      return /\.txt$/i.test(path) || /_manifest\.json$/i.test(path);
    });
    if (!selected.length) {
      showToast("文件夹中没有 TXT 或 _manifest.json");
      return;
    }
    await flushPendingWrites();
    showToast("正在读取文件夹…");
    try {
      const entries = await Promise.all(selected.map(async function (file) {
        const path = file.webkitRelativePath || file.name;
        return { path: path, bytes: new Uint8Array(await file.arrayBuffer()) };
      }));
      importEntries(entries, "folder");
    } catch (error) {
      showToast("文件夹读取失败：" + ((error && error.message) || "未知错误"));
    }
  }

  async function resplit() {
    if (!state.book) {
      showToast("请先导入文件");
      return;
    }
    const previous = state.book;
    if (previous.reconstructed && !window.confirm("重新切分将基于拼接文本，可能改变结构，继续？")) {
      return;
    }
    try {
      cancelPendingWrites();
      await persist.chain;
      const book = rebuildBook(previous.rawText);
      book.id = previous.id;
      book.createdAt = previous.createdAt;
      book.title = previous.title || bookTitle(book.fileName);
      book.source = previous.source || "txt";
      state.book = book;
      renderAll();
      notifyBookChanged();
      showToast("已重新切分：" + book.stats.volumes + " 卷 / " + book.stats.chapters + " 节");
      persistImportedBook(book, book.source);
    } catch (error) {
      showToast(error.message || "切分失败");
    }
  }

  function saveTitle() {
    const chapter = selectedChapter();
    if (!chapter) return;
    const value = $("chapterTitleInput").value.trim();
    if (!value) {
      showToast("标题不能为空");
      return;
    }
    chapter.title = value;
    chapter.edited = value !== chapter.rawTitle;
    queueChapter(chapter);
    renderAll();
    showToast("标题已保存");
  }

  function toggleExclude() {
    const chapter = selectedChapter();
    if (!chapter) return;
    chapter.excluded = !chapter.excluded;
    chapter.manual = true;
    queueChapter(chapter);
    renderAll();
    showToast(chapter.excluded ? "已排除，导出时跳过" : "已恢复");
  }

  function currentOptions() {
    return {
      includeExcluded: $("optIncludeExcluded").checked,
      includeNotes: $("optIncludeNotes").checked,
      useEditedTitles: $("optUseEditedTitles").checked,
      cleanWatermark: $("optCleanWatermark").checked,
      cleanTrailingNotes: $("optCleanTrailingNotes").checked,
    };
  }

  function applyOptions(options) {
    $("optIncludeExcluded").checked = !!options.includeExcluded;
    $("optIncludeNotes").checked = options.includeNotes !== false;
    $("optUseEditedTitles").checked = options.useEditedTitles !== false;
    $("optCleanWatermark").checked = options.cleanWatermark !== false;
    $("optCleanTrailingNotes").checked = options.cleanTrailingNotes !== false;
  }

  function persistOptions() {
    state.options = currentOptions();
    saveJSON(OPTIONS_KEY, state.options);
    renderExportSummary();
  }

  function requireBook() {
    if (!state.book) {
      showToast("请先导入文件");
      return false;
    }
    return true;
  }

  function exportTxt() {
    if (!requireBook()) return;
    const result = ND.exportPlainText(state.book, currentOptions());
    ND.downloadBlob(result.fileName, result.blob);
    showToast("已导出 " + result.fileName);
  }

  function exportZip() {
    if (!requireBook()) return;
    showToast("正在打包 ZIP…");
    setTimeout(function () {
      try {
        const result = ND.exportZip(state.book, currentOptions());
        ND.downloadBlob(result.fileName, result.blob);
        showToast("已导出 " + result.fileName);
      } catch (error) {
        showToast("打包失败：" + error.message);
      }
    }, 50);
  }

  function exportEpub() {
    if (!requireBook()) return;
    showToast("正在生成 EPUB…");
    setTimeout(function () {
      try {
        const result = ND.exportEpub(state.book, currentOptions());
        ND.downloadBlob(result.fileName, result.blob);
        showToast("已导出 " + result.fileName);
      } catch (error) {
        showToast("生成失败：" + error.message);
      }
    }, 50);
  }

  function exportChapter() {
    const chapter = selectedChapter();
    if (!chapter) return;
    try {
      const result = ND.buildChapterFile(state.book, chapter, currentOptions());
      ND.downloadBlob(
        result.fileName,
        new Blob([result.content], { type: "text/plain;charset=utf-8" }),
      );
      showToast("已导出当前章节");
    } catch (error) {
      showToast("导出失败：" + ((error && error.message) || "未知错误"));
    }
  }

  async function exportFolder() {
    if (!requireBook()) return;
    if (!exportTarget.ready) {
      showToast("正在检测导出目标，请稍后重试");
      return;
    }
    if (ND.exportTarget.mode() === "unsupported") {
      showToast("当前环境不支持写入目录，请用 start.bat 启动或导出 ZIP");
      return;
    }

    let plan;
    try {
      plan = ND.exportFolder(state.book, currentOptions());
    } catch (error) {
      showToast("导出准备失败：" + ((error && error.message) || "未知错误"));
      return;
    }

    try {
      const result = await ND.exportTarget.save(plan);
      renderExportTargetHint();
      showToast("已写入 " + result.path + "（" + result.count + " 个文件）");
    } catch (error) {
      showToast((error && error.message) || "写入目录失败");
    }
  }

  function bulkExcludeSuspects() {
    if (!state.book) return;
    allChapters().forEach(function (chapter) {
      if (chapter.junkType === "junk" || chapter.junkType === "suspect") {
        chapter.excluded = true;
        chapter.manual = true;
        queueChapter(chapter);
      }
    });
    renderAll();
    showToast("已排除全部疑似章节");
  }

  function restoreAll() {
    if (!state.book) return;
    allChapters().forEach(function (chapter) {
      chapter.excluded = false;
      chapter.manual = true;
      queueChapter(chapter);
    });
    renderAll();
    showToast("已恢复全部章节");
  }

  function reclassify() {
    if (!state.book) return;
    ND.classifyBook(state.book, { extraKeywords: readRules().extraKeywords });
    persist.fullDirty = true;
    scheduleSaveFlush();
    renderAll();
    showToast("已重新检测");
  }

  function bindEvents() {
    $("importButton").onclick = function () {
      $("fileInput").click();
    };
    $("fileInput").onchange = importFile;
    $("importFolderButton").onclick = function () {
      $("folderInput").click();
    };
    $("folderInput").onchange = importFolder;
    $("splitButton").onclick = resplit;
    $("exportTxtButton").onclick = exportTxt;
    $("exportTxtButton2").onclick = exportTxt;
    $("exportZipButton").onclick = exportZip;
    $("exportEpubButton").onclick = exportEpub;
    $("exportFolderButton").onclick = exportFolder;
    $("saveTitleButton").onclick = saveTitle;
    $("toggleExcludeButton").onclick = toggleExclude;
    $("prevChapterButton").onclick = function () { goRelative(-1); };
    $("nextChapterButton").onclick = function () { goRelative(1); };
    $("exportChapterButton").onclick = exportChapter;
    $("pluginRefreshButton").onclick = refreshPlugins;
    $("templateSaveButton").onclick = saveTemplates;
    $("templateResetButton").onclick = resetTemplates;
    ["tplVolumeFolder", "tplChapterFile", "tplHeader"].forEach(function (id) {
      $(id).oninput = renderTemplatePreview;
    });
    $("excludeSuspectsButton").onclick = bulkExcludeSuspects;
    $("restoreAllButton").onclick = restoreAll;
    $("reclassifyButton").onclick = reclassify;
    $("cleanSelectAll").onchange = function () {
      toggleCleanSelectAll(this.checked);
    };
    $("cleanExcludeSelected").onclick = function () {
      setCleanSelectedExcluded(true);
    };
    $("cleanRestoreSelected").onclick = function () {
      setCleanSelectedExcluded(false);
    };
    $("cleanClearSelection").onclick = clearCleanSelection;
    $("cleanPreviewToggleExclude").onclick = toggleCleanPreviewExclude;
    $("cleanPreviewOpenReader").onclick = openCleanPreviewReader;

    const cleanList = $("cleanList");
    cleanList.addEventListener("mousedown", onCleanMouseDown);
    cleanList.addEventListener("mouseover", onCleanMouseOver);
    cleanList.addEventListener("click", function (event) {
      if (event.target.closest("[data-exclude]")) {
        event.stopPropagation();
        return;
      }
      const open = event.target.closest("[data-open]");
      if (!open) return;
      event.stopPropagation();
      selectChapter(open.dataset.open);
    });
    cleanList.addEventListener("change", function (event) {
      const input = event.target;
      if (!input.matches("[data-exclude]")) return;
      const chapter = allChapters().find(function (item) {
        return item.id === input.dataset.exclude;
      });
      if (!chapter) return;
      chapter.excluded = input.checked;
      chapter.manual = true;
      queueChapter(chapter);
      renderAll();
    });
    document.addEventListener("mouseup", onCleanMouseUp);
    $("defaultRulesButton").onclick = function () {
      applyRules(defaultRules());
      showToast("已恢复默认规则，点击“重新切分”生效");
    };

    $("tocFilter").oninput = function () {
      state.filter = $("tocFilter").value;
      renderToc();
      scheduleSettingsSave();
    };

    $("shelfClearButton").onclick = clearShelf;

    window.addEventListener("beforeunload", function () {
      if (!persist.available) return;
      flushScheduled();
      flushSettings();
    });
    $("tocExpandAll").onclick = function () {
      state.collapsed.clear();
      renderToc();
    };
    $("tocCollapseAll").onclick = function () {
      state.book && state.book.volumes.forEach(function (volume) {
        state.collapsed.add(volume.id);
      });
      renderToc();
    };

    document.querySelectorAll(".nav button").forEach(function (button) {
      button.onclick = function () {
        switchView(button.dataset.view);
      };
    });

    ["optIncludeExcluded", "optIncludeNotes", "optUseEditedTitles", "optCleanWatermark", "optCleanTrailingNotes"].forEach(function (id) {
      $(id).onchange = persistOptions;
    });

    document.addEventListener("keydown", function (event) {
      if (state.view !== "reader") return;
      const tag = (event.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (event.key === "ArrowLeft") goRelative(-1);
      if (event.key === "ArrowRight") goRelative(1);
    });

    document.addEventListener("keydown", function (event) {
      if (state.view !== "clean" || event.key !== "Escape") return;
      const tag = (event.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      clearCleanSelection();
    });
  }

  function init() {
    applyRules(loadRules());
    state.options = Object.assign({}, state.options, loadJSON(OPTIONS_KEY, {}));
    applyOptions(state.options);
    applyTemplateInputs(ND.plugins.templates());
    bindEvents();
    renderAll();
    renderSaveStatus();
    renderShelf();
    renderPlugins();
    renderPluginViews();
    ND.plugins.load().then(function () {
      renderPlugins();
      renderPluginViews();
    });
    ND.exportTarget
      .init()
      .then(function (result) {
        exportTarget.ready = true;
        exportTarget.result = result;
        renderExportTargetHint();
        const button = $("exportFolderButton");
        if (button) button.disabled = false;
      })
      .catch(function () {
        exportTarget.ready = true;
        renderExportTargetHint();
        const button = $("exportFolderButton");
        if (button) button.disabled = false;
      });
    restoreSession();
  }

  init();
})();

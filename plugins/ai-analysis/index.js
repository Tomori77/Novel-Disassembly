(function () {
  "use strict";

  if (!window.ND || !window.ND.plugins) return;

  var PLUGIN_VERSION = "0.2.0";
  var MAX_CHAPTERS = 50;
  var MAX_BODY_CHARS = 8000;
  var MAX_VOLUME_INPUT = 12000;
  var MAX_BOOK_INPUT = 16000;
  var MAX_SUMMARY_INPUT = 12000;
  var TIMEOUT_MS = 90000;

  var PRESETS = {
    openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    glm: { label: "GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
    ollama: { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
    custom: { label: "自定义", baseUrl: "", model: "" },
  };
  var PRESET_ORDER = ["openai", "deepseek", "glm", "ollama", "custom"];

  var CATEGORY_ORDER = [
    "outline", "characters", "items", "places", "factions", "events", "foreshadows",
  ];
  var CATEGORY_LABELS = {
    outline: "大纲",
    characters: "人物",
    items: "物品/道具",
    places: "地点",
    factions: "势力",
    events: "事件",
    foreshadows: "伏笔",
  };
  var ENTITY_CATEGORY = {
    characters: "character",
    items: "item",
    places: "place",
    factions: "faction",
    events: "event",
    foreshadows: "foreshadow",
  };
  var CATEGORY_BY_ENTITY = {
    character: "characters",
    item: "items",
    place: "places",
    faction: "factions",
    event: "events",
    foreshadow: "foreshadows",
  };
  var ENTITY_TYPES = ["character", "item", "place", "faction", "event", "foreshadow"];
  var TYPE_LABELS = {
    character: "人物",
    item: "物品",
    place: "地点",
    faction: "势力",
    event: "事件",
    foreshadow: "伏笔",
  };
  var ENCYCLOPEDIA_KEYS = [
    "characters", "items", "places", "factions", "events", "foreshadows",
  ];
  var ENTITY_FIELDS = {
    characters: [
      ["aliases", "别名", true],
      ["role", "身份/作用"],
      ["faction", "阵营"],
      ["description", "描述"],
      ["arc", "弧线"],
      ["firstChapter", "首次出现"],
      ["importance", "重要度"],
    ],
    items: [
      ["type", "类型"],
      ["function", "作用"],
      ["owner", "归属"],
      ["firstChapter", "首次出现"],
      ["description", "描述"],
    ],
    places: [
      ["type", "类型"],
      ["firstChapter", "首次出现"],
      ["description", "描述"],
    ],
    factions: [
      ["type", "类型"],
      ["firstChapter", "首次出现"],
      ["description", "描述"],
    ],
    events: [
      ["chapter", "章节"],
      ["significance", "意义"],
      ["description", "描述"],
    ],
    foreshadows: [
      ["setup", "埋设"],
      ["payoff", "回收"],
      ["status", "状态"],
      ["description", "描述"],
    ],
  };

  function emptyEncyclopedia() {
    return {
      characters: [], items: [], places: [], factions: [], events: [], foreshadows: [],
    };
  }

  function emptyConfig() {
    return {
      preset: "",
      baseUrl: "",
      model: "",
      apiKey: "",
      skipExcluded: true,
      categories: CATEGORY_ORDER.slice(),
    };
  }

  function emptyResults() {
    return {
      chapters: {},
      volumeSummaries: {},
      bookSummary: null,
      outline: null,
      encyclopedia: emptyEncyclopedia(),
      entityMeta: { lastRunAt: "", categories: [] },
      updatedAt: "",
    };
  }

  function normalizeCategories(value) {
    if (!Array.isArray(value)) return CATEGORY_ORDER.slice();
    var result = [];
    CATEGORY_ORDER.forEach(function (key) {
      if (value.indexOf(key) >= 0 && result.indexOf(key) < 0) result.push(key);
    });
    return result;
  }

  function normalizeConfig(value) {
    var source = value && typeof value === "object" ? value : {};
    return {
      preset: typeof source.preset === "string" ? source.preset : "",
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : "",
      model: typeof source.model === "string" ? source.model : "",
      apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
      skipExcluded: source.skipExcluded !== false,
      categories: normalizeCategories(source.categories),
    };
  }

  function toText(value) {
    return value == null ? "" : String(value);
  }

  function truncate(value, limit) {
    var text = String(value == null ? "" : value);
    return text.length > limit ? text.slice(0, limit) : text;
  }

  function makeElement(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function clearNode(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function setStatus(node, text, kind) {
    if (!node) return;
    node.textContent = text || "";
    node.className = "ai-status" + (kind ? " " + kind : "");
  }

  function isConfigured(config) {
    return !!(String(config.baseUrl || "").trim() && String(config.model || "").trim());
  }

  function endpointOf(baseUrl) {
    var base = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!base) return "";
    if (/\/chat\/completions$/i.test(base)) return base;
    return base + "/chat/completions";
  }

  function bookStorageKey(book) {
    if (!book) return "";
    return "book:" + String(book.id || book.fileName || "unknown");
  }

  function bookTitle(book) {
    if (!book) return "";
    return String(book.title || book.fileName || "").replace(/\.txt$/i, "").trim() || "未命名";
  }

  function chapterTitle(chapter) {
    return String((chapter && (chapter.title || chapter.rawTitle)) || "未命名章节");
  }

  function volumeTitle(volume) {
    return String(
      (volume && (volume.rawTitle || volume.title || volume.name)) || "未命名卷",
    );
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function formatTime(value) {
    var date = new Date(String(value || ""));
    if (isNaN(date.getTime())) return "";
    return (
      date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) +
      " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes())
    );
  }

  function stampNow() {
    var date = new Date();
    return (
      date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate()) + "-" +
      pad2(date.getHours()) + pad2(date.getMinutes())
    );
  }

  function normalizeEntityType(value) {
    var type = toText(value).trim().toLowerCase();
    if (type === "人物" || type === "角色" || type === "character" || type === "characters") {
      return "character";
    }
    if (
      type === "物品" || type === "道具" || type === "item" || type === "items" ||
      type === "prop" || type === "props" || type === "object"
    ) {
      return "item";
    }
    if (
      type === "地点" || type === "场景" || type === "place" || type === "places" ||
      type === "location" || type === "locations"
    ) {
      return "place";
    }
    if (
      type === "势力" || type === "组织" || type === "faction" || type === "factions" ||
      type === "organization" || type === "organizations" || type === "group"
    ) {
      return "faction";
    }
    if (type === "事件" || type === "event" || type === "events") return "event";
    if (
      type === "伏笔" || type === "伏线" || type === "foreshadow" ||
      type === "foreshadows" || type === "foreshadowing" || type === "setup"
    ) {
      return "foreshadow";
    }
    return "";
  }

  function normalizeAliases(value, name) {
    var aliases = [];
    var list = [];
    if (Array.isArray(value)) list = value;
    else if (typeof value === "string") list = value.split(/[，,、;；/|]+/);
    list.forEach(function (alias) {
      var text = toText(alias).trim();
      if (!text || text === name) return;
      if (aliases.indexOf(text) < 0) aliases.push(text);
    });
    return aliases;
  }

  function normalizeEntity(item, allowedTypes) {
    if (!item || typeof item !== "object") return null;
    var type = normalizeEntityType(item.type || item.entityType || item.category);
    if (!type) return null;
    if (allowedTypes && allowedTypes.indexOf(type) < 0) return null;
    var name = toText(item.name || item.title).trim();
    if (!name) return null;
    return {
      type: type,
      name: name,
      aliases: normalizeAliases(item.aliases, name),
      note: toText(item.note || item.description || item.desc).trim(),
      role: toText(item.role).trim(),
      faction: toText(item.faction).trim(),
      function: toText(item.function || item.func || item.purpose).trim(),
      owner: toText(item.owner).trim(),
      chapter: toText(item.chapter || item.firstChapter || item.first_chapter).trim(),
      setup: toText(item.setup).trim(),
      payoff: toText(item.payoff).trim(),
      status: toText(item.status).trim(),
      importance: toText(item.importance).trim(),
    };
  }

  function normalizeKeyExcerpts(value) {
    var source = [];
    if (Array.isArray(value)) source = value;
    else if (typeof value === "string") source = [value];
    var result = [];
    source.forEach(function (item) {
      var text = "";
      if (item && typeof item === "object") text = toText(item.text || item.excerpt);
      else text = toText(item);
      text = truncate(text.trim(), 80);
      if (!text || result.indexOf(text) >= 0) return;
      if (result.length < 3) result.push(text);
    });
    return result;
  }

  function entityTokenKey(value) {
    return toText(value)
      .toLowerCase()
      .replace(/[\s\u3000·・,，、。:：;；!！?？'"“”‘’()（）【】\[\]<>《》\-—_]/g, "");
  }

  function entityTokens(item) {
    var tokens = [];
    [item.name].concat(item.aliases || []).forEach(function (value) {
      var token = entityTokenKey(value);
      if (token && tokens.indexOf(token) < 0) tokens.push(token);
    });
    return tokens;
  }

  function intersects(a, b) {
    for (var i = 0; i < a.length; i += 1) {
      if (b.indexOf(a[i]) >= 0) return true;
    }
    return false;
  }

  function mergeEntity(target, source) {
    (source.aliases || []).forEach(function (alias) {
      if (alias === target.name) return;
      if (target.aliases.indexOf(alias) < 0) target.aliases.push(alias);
    });
    Object.keys(source).forEach(function (key) {
      if (key === "name" || key === "aliases") return;
      if (!target[key] && source[key]) target[key] = source[key];
    });
  }

  function normalizeEncyclopediaItem(category, item) {
    if (!item || typeof item !== "object") return null;
    var name = toText(item.name || item.title).trim();
    if (!name) return null;
    var result = { name: name };
    if (category === "characters") {
      result.aliases = normalizeAliases(item.aliases, name);
      result.role = toText(item.role || item.identity).trim();
      result.faction = toText(item.faction || item.camp).trim();
      result.description = toText(item.description || item.desc || item.note).trim();
      result.arc = toText(item.arc).trim();
      result.firstChapter = toText(item.firstChapter || item.first_chapter || item.chapter).trim();
      result.importance = toText(item.importance).trim();
    } else if (category === "items") {
      result.type = toText(item.type || item.kind || item.category).trim();
      result.function = toText(item.function || item.func || item.purpose || item.note).trim();
      result.owner = toText(item.owner).trim();
      result.firstChapter = toText(item.firstChapter || item.first_chapter || item.chapter).trim();
      result.description = toText(item.description || item.desc).trim();
    } else if (category === "places" || category === "factions") {
      result.type = toText(item.type || item.kind || item.category).trim();
      result.firstChapter = toText(item.firstChapter || item.first_chapter || item.chapter).trim();
      result.description = toText(item.description || item.desc || item.note).trim();
    } else if (category === "events") {
      result.chapter = toText(item.chapter || item.firstChapter || item.first_chapter).trim();
      result.description = toText(item.description || item.desc || item.note).trim();
      result.significance = toText(item.significance || item.meaning).trim();
    } else if (category === "foreshadows") {
      result.setup = toText(item.setup).trim();
      result.payoff = toText(item.payoff).trim();
      result.status = toText(item.status).trim();
      result.description = toText(item.description || item.desc || item.note).trim();
    }
    return result;
  }

  function dedupeEntityList(category, list) {
    var entries = [];
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var item = normalizeEncyclopediaItem(category, raw);
      if (!item) return;
      var tokens = entityTokens(item);
      var match = null;
      for (var i = 0; i < entries.length; i += 1) {
        if (intersects(entries[i].tokens, tokens)) {
          match = entries[i];
          break;
        }
      }
      if (match) {
        mergeEntity(match.item, item);
        entityTokens(match.item).forEach(function (token) {
          if (match.tokens.indexOf(token) < 0) match.tokens.push(token);
        });
      } else {
        entries.push({ item: item, tokens: tokens });
      }
    });
    return entries.map(function (entry) {
      return entry.item;
    });
  }

  function normalizeEncyclopedia(value) {
    var source = value && typeof value === "object" ? value : {};
    var result = emptyEncyclopedia();
    ENCYCLOPEDIA_KEYS.forEach(function (key) {
      if (Array.isArray(source[key])) result[key] = dedupeEntityList(key, source[key]);
    });
    return result;
  }

  function hasEncyclopediaData(encyclopedia) {
    if (!encyclopedia) return false;
    return ENCYCLOPEDIA_KEYS.some(function (key) {
      return Array.isArray(encyclopedia[key]) && encyclopedia[key].length > 0;
    });
  }

  function normalizeVolumeOutline(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var summary = toText(value.summary).trim();
    var events = [];
    var source = Array.isArray(value.keyEvents)
      ? value.keyEvents
      : typeof value.keyEvents === "string"
        ? [value.keyEvents]
        : [];
    source.forEach(function (event) {
      var text = toText(event).trim();
      if (text && events.indexOf(text) < 0) events.push(text);
    });
    if (!summary && !events.length) return null;
    return { summary: summary, keyEvents: events };
  }

  function normalizeBookOutline(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    var logline = toText(value.logline).trim();
    var synopsis = toText(value.synopsis).trim();
    var themes = [];
    var themeSource = Array.isArray(value.themes)
      ? value.themes
      : typeof value.themes === "string"
        ? [value.themes]
        : [];
    themeSource.forEach(function (theme) {
      var text = toText(theme).trim();
      if (text && themes.indexOf(text) < 0) themes.push(text);
    });
    var arcs = [];
    if (Array.isArray(value.arcs)) {
      value.arcs.forEach(function (raw) {
        if (!raw || typeof raw !== "object") return;
        var title = toText(raw.title || raw.name).trim();
        var arcSummary = toText(raw.summary).trim();
        var keyEvents = [];
        var eventSource = Array.isArray(raw.keyEvents)
          ? raw.keyEvents
          : typeof raw.keyEvents === "string"
            ? [raw.keyEvents]
            : [];
        eventSource.forEach(function (event) {
          var text = toText(event).trim();
          if (text && keyEvents.indexOf(text) < 0) keyEvents.push(text);
        });
        var chapters = Array.isArray(raw.chapters)
          ? raw.chapters.map(function (item) { return toText(item).trim(); }).filter(Boolean).join("、")
          : toText(raw.chapters).trim();
        if (!title && !arcSummary && !keyEvents.length && !chapters) return;
        arcs.push({ title: title, summary: arcSummary, keyEvents: keyEvents, chapters: chapters });
      });
    }
    if (!logline && !synopsis && !themes.length && !arcs.length) return null;
    return {
      logline: logline,
      synopsis: synopsis,
      themes: themes,
      arcs: arcs,
      at: toText(value.at),
      model: toText(value.model),
    };
  }

  function normalizeStoredChapter(item) {
    var source = item && typeof item === "object" ? item : {};
    var entities = [];
    if (Array.isArray(source.entities)) {
      source.entities.forEach(function (entity) {
        var normalized = normalizeEntity(entity);
        if (normalized) entities.push(normalized);
      });
    }
    return {
      title: toText(source.title),
      summary: toText(source.summary),
      events: Array.isArray(source.events)
        ? source.events.map(function (event) { return toText(event); }).filter(Boolean)
        : [],
      keyExcerpts: normalizeKeyExcerpts(source.keyExcerpts),
      entities: entities,
      model: toText(source.model),
      at: toText(source.at),
      error: toText(source.error),
    };
  }

  function normalizeResults(value) {
    var source = value && typeof value === "object" ? value : {};
    var result = emptyResults();
    if (source.chapters && typeof source.chapters === "object" && !Array.isArray(source.chapters)) {
      Object.keys(source.chapters).forEach(function (key) {
        result.chapters[key] = normalizeStoredChapter(source.chapters[key]);
      });
    }
    if (
      source.volumeSummaries &&
      typeof source.volumeSummaries === "object" &&
      !Array.isArray(source.volumeSummaries)
    ) {
      Object.keys(source.volumeSummaries).forEach(function (key) {
        var item = source.volumeSummaries[key];
        if (!item || typeof item !== "object") return;
        result.volumeSummaries[key] = {
          summary: toText(item.summary),
          outline: normalizeVolumeOutline(item.outline),
          entities: normalizeEncyclopedia(item.entities),
          at: toText(item.at),
          error: toText(item.error),
        };
      });
    }
    if (
      source.bookSummary &&
      typeof source.bookSummary === "object" &&
      !Array.isArray(source.bookSummary)
    ) {
      result.bookSummary = {
        summary: toText(source.bookSummary.summary),
        at: toText(source.bookSummary.at),
      };
    }
    result.outline = normalizeBookOutline(source.outline);
    result.encyclopedia = normalizeEncyclopedia(source.encyclopedia);
    if (source.entityMeta && typeof source.entityMeta === "object") {
      result.entityMeta = {
        lastRunAt: toText(source.entityMeta.lastRunAt),
        categories: normalizeCategories(source.entityMeta.categories),
      };
    }
    if (typeof source.updatedAt === "string") result.updatedAt = source.updatedAt;
    return result;
  }

  function selectedEntityTypes(categories) {
    var types = [];
    (categories || []).forEach(function (category) {
      var type = ENTITY_CATEGORY[category];
      if (type && types.indexOf(type) < 0) types.push(type);
    });
    return types;
  }

  function categoryEnabled(categories, category) {
    return (categories || []).indexOf(category) >= 0;
  }

  function chapterPrompt(chapter, categories) {
    var body = truncate(chapter.body || "", MAX_BODY_CHARS);
    var types = selectedEntityTypes(categories);
    var typeText = types.length
      ? types.map(function (type) { return TYPE_LABELS[type] + "(" + type + ")"; }).join("、")
      : "";
    var entityInstruction = types.length
      ? "只抽取以下实体类别：" + typeText + "，不要输出未列出的类别。"
      : "不需要抽取实体，entities 返回空数组。";
    var entitySchema =
      '"entities":[{"type":"' + (types.length ? types.join("|") : "") + '","name":"","aliases":[],' +
      '"note":"","role":"","faction":"","function":"","owner":"","chapter":"",' +
      '"setup":"","payoff":"","status":"","importance":""}]';
    return [
      {
        role: "system",
        content: "你是小说拆解助手。严格只输出 JSON，不要 Markdown 代码块，不要解释。",
      },
      {
        role: "user",
        content:
          "章节标题：" + chapterTitle(chapter) + "\n" +
          "正文（最多 8000 字）：\n" + body + "\n\n" +
          "任务：拆解本章。summary 与 events 始终输出。\n" +
          entityInstruction + "\n" +
          "keyExcerpts 输出 1-3 条关键原文短句，每条不超过 80 字，用于后续归并。\n" +
          "人物填 role/faction/note；物品填 function/owner/note；地点/势力填 note；" +
          "事件填 note/chapter；伏笔填 setup/payoff/status/note。\n" +
          "严格只输出以下 JSON：\n" +
          '{"summary":"不超过150字","events":["关键事件"],' +
          '"keyExcerpts":["1-3条原文短句，每条不超过80字"],' + entitySchema + "}",
      },
    ];
  }

  function groupChapterEntities(entities, types) {
    var groups = {};
    (entities || []).forEach(function (entity) {
      if (!entity || types.indexOf(entity.type) < 0) return;
      if (!groups[entity.type]) groups[entity.type] = [];
      groups[entity.type].push(entity);
    });
    return groups;
  }

  function entityBrief(entity) {
    var parts = [entity.name];
    if (entity.aliases && entity.aliases.length) parts.push("（" + entity.aliases.join("、") + "）");
    var details = [];
    if (entity.role) details.push("身份：" + entity.role);
    if (entity.faction) details.push("阵营：" + entity.faction);
    if (entity.function) details.push("作用：" + entity.function);
    if (entity.owner) details.push("归属：" + entity.owner);
    if (entity.chapter) details.push("章节：" + entity.chapter);
    if (entity.setup) details.push("埋设：" + entity.setup);
    if (entity.payoff) details.push("回收：" + entity.payoff);
    if (entity.status) details.push("状态：" + entity.status);
    if (entity.importance) details.push("重要度：" + entity.importance);
    if (entity.note) details.push(entity.note);
    if (details.length) parts.push(" - " + details.join("；"));
    return parts.join("");
  }

  function appendEntityGroups(lines, entities, types) {
    var groups = groupChapterEntities(entities, types);
    var parts = [];
    ENTITY_TYPES.forEach(function (type) {
      if (!groups[type] || !groups[type].length) return;
      parts.push(TYPE_LABELS[type] + "：" + groups[type].map(entityBrief).join("；"));
    });
    if (parts.length) lines.push("实体：" + parts.join(" | "));
  }

  function volumeInputText(volume, entries, categories) {
    var types = selectedEntityTypes(categories);
    var lines = ["【本卷：" + volumeTitle(volume) + "】"];
    entries.forEach(function (entry) {
      var item = entry.item;
      lines.push("【" + chapterTitle(entry.chapter) + "】");
      lines.push("摘要：" + (item.summary || "（无）"));
      if (item.events && item.events.length) {
        lines.push("关键事件：" + item.events.join("；"));
      }
      if (item.keyExcerpts && item.keyExcerpts.length) {
        lines.push("关键原文：" + item.keyExcerpts.join(" / "));
      }
      appendEntityGroups(lines, item.entities, types);
    });
    var text = lines.join("\n");
    if (text.length > MAX_VOLUME_INPUT) {
      text = text.slice(0, MAX_VOLUME_INPUT) + "\n（内容过长，已截断）";
    }
    return text;
  }

  function volumeSpec(categories) {
    var parts = ['"volumeSummary":"200字以内的本卷摘要"'];
    if (categoryEnabled(categories, "outline")) {
      parts.push('"outline":{"summary":"卷大纲","keyEvents":["关键事件"]}');
    }
    if (categoryEnabled(categories, "characters")) {
      parts.push(
        '"characters":[{"name":"","aliases":[],"role":"","faction":"","description":"","arc":"","firstChapter":"","importance":""}]',
      );
    }
    if (categoryEnabled(categories, "items")) {
      parts.push(
        '"items":[{"name":"","type":"","function":"","owner":"","description":"","firstChapter":""}]',
      );
    }
    if (categoryEnabled(categories, "places")) {
      parts.push('"places":[{"name":"","type":"","description":"","firstChapter":""}]');
    }
    if (categoryEnabled(categories, "factions")) {
      parts.push('"factions":[{"name":"","type":"","description":"","firstChapter":""}]');
    }
    if (categoryEnabled(categories, "events")) {
      parts.push('"events":[{"name":"","chapter":"","description":"","significance":""}]');
    }
    if (categoryEnabled(categories, "foreshadows")) {
      parts.push(
        '"foreshadows":[{"name":"","setup":"","payoff":"","status":"","description":""}]',
      );
    }
    return "{" + parts.join(",") + "}";
  }

  function volumePrompt(volume, entries, categories) {
    var text = volumeInputText(volume, entries, categories);
    var selected = categories.filter(function (key) { return key !== "outline"; });
    var categoryText = selected.length
      ? "本次勾选的设定集类别：" + selected.map(function (key) { return CATEGORY_LABELS[key]; }).join("、") + "。"
      : "本次没有勾选设定集类别，只需归并卷摘要。";
    return [
      {
        role: "system",
        content: "你是小说拆解助手。严格只输出 JSON，不要 Markdown 代码块，不要解释。",
      },
      {
        role: "user",
        content:
          "以下是本卷的逐章摘要、关键原文与已抽实体。请归并成本卷摘要与卷级设定集。\n" +
          "卷标题：" + volumeTitle(volume) + "\n" +
          categoryText + "\n" +
          "要求：合并同一实体的别名与重复项；保留首次出现、重要度、作用/功能描述；" +
          "只输出勾选类别，不要输出未列出的字段。\n" +
          "严格只输出以下 JSON：\n" + volumeSpec(categories) + "\n\n" + text,
      },
    ];
  }

  function formatVolumeEntry(volume, entry, categories) {
    var types = selectedEntityTypes(categories);
    var lines = ["【" + volumeTitle(volume) + "】"];
    lines.push("卷摘要：" + (entry.summary || "（无）"));
    if (entry.outline) {
      lines.push("卷大纲：" + (entry.outline.summary || "（无）"));
      if (entry.outline.keyEvents.length) {
        lines.push("卷关键事件：" + entry.outline.keyEvents.join("；"));
      }
    }
    var encyclopedia = entry.entities || emptyEncyclopedia();
    ENTITY_TYPES.forEach(function (type) {
      var category = CATEGORY_BY_ENTITY[type];
      if (types.indexOf(type) < 0) return;
      var list = encyclopedia[category] || [];
      if (!list.length) return;
      lines.push(
        TYPE_LABELS[type] + "：" + list.map(function (entity) {
          var parts = [entity.name];
          if (entity.aliases && entity.aliases.length) {
            parts.push("（" + entity.aliases.join("、") + "）");
          }
          var details = [];
          if (entity.role) details.push("身份：" + entity.role);
          if (entity.faction) details.push("阵营：" + entity.faction);
          if (entity.function) details.push("作用：" + entity.function);
          if (entity.owner) details.push("归属：" + entity.owner);
          if (entity.firstChapter) details.push("首次：" + entity.firstChapter);
          if (entity.importance) details.push("重要度：" + entity.importance);
          if (entity.chapter) details.push("章节：" + entity.chapter);
          if (entity.setup) details.push("埋设：" + entity.setup);
          if (entity.payoff) details.push("回收：" + entity.payoff);
          if (entity.status) details.push("状态：" + entity.status);
          if (entity.description) details.push(entity.description);
          if (details.length) parts.push(" - " + details.join("；"));
          return parts.join("");
        }).join("；"),
      );
    });
    return lines.join("\n");
  }

  function bookInputText(volumeEntries, categories) {
    var lines = ["以下是全书各卷的摘要、卷大纲与卷级设定集。"];
    volumeEntries.forEach(function (entry) {
      lines.push("");
      lines.push(formatVolumeEntry(entry.volume, entry.item, categories));
    });
    var text = lines.join("\n");
    if (text.length > MAX_BOOK_INPUT) {
      text = text.slice(0, MAX_BOOK_INPUT) + "\n（内容过长，已截断）";
    }
    return text;
  }

  function bookSpec(categories) {
    var parts = [];
    if (categoryEnabled(categories, "outline")) {
      parts.push(
        '"outline":{"logline":"一句话","synopsis":"全书梗概 300-600 字","themes":["主题"],' +
        '"arcs":[{"title":"卷/阶段名","summary":"","keyEvents":[],"chapters":""}]}',
      );
    }
    if (categoryEnabled(categories, "characters")) {
      parts.push(
        '"characters":[{"name":"","aliases":[],"role":"","faction":"","description":"","arc":"","firstChapter":"","importance":""}]',
      );
    }
    if (categoryEnabled(categories, "items")) {
      parts.push(
        '"items":[{"name":"","type":"","function":"","owner":"","description":"","firstChapter":""}]',
      );
    }
    if (categoryEnabled(categories, "places")) {
      parts.push('"places":[{"name":"","type":"","description":"","firstChapter":""}]');
    }
    if (categoryEnabled(categories, "factions")) {
      parts.push('"factions":[{"name":"","type":"","description":"","firstChapter":""}]');
    }
    if (categoryEnabled(categories, "events")) {
      parts.push('"events":[{"name":"","chapter":"","description":"","significance":""}]');
    }
    if (categoryEnabled(categories, "foreshadows")) {
      parts.push(
        '"foreshadows":[{"name":"","setup":"","payoff":"","status":"","description":""}]',
      );
    }
    return "{" + parts.join(",") + "}";
  }

  function bookPrompt(book, volumeEntries, categories) {
    var text = bookInputText(volumeEntries, categories);
    var selected = categories.filter(function (key) { return key !== "outline"; });
    var categoryText = selected.length
      ? "本次勾选的设定集类别：" + selected.map(function (key) { return CATEGORY_LABELS[key]; }).join("、") + "。"
      : "本次没有勾选设定集类别，只需生成全书大纲。";
    return [
      {
        role: "system",
        content: "你是小说拆解助手。严格只输出 JSON，不要 Markdown 代码块，不要解释。",
      },
      {
        role: "user",
        content:
          "以下是全书各卷的摘要、卷大纲与卷级设定集。请汇总为全书大纲与合并后的设定集。\n" +
          "书名：" + bookTitle(book) + "\n" +
          categoryText + "\n" +
          "要求：按名称与别名合并重复项，保留首次出现、重要度、作用/功能描述；" +
          "arcs 按卷/阶段排列；只输出勾选类别，不要输出未列出的字段。\n" +
          "严格只输出以下 JSON：\n" + bookSpec(categories) + "\n\n" + text,
      },
    ];
  }

  function parseJsonContent(content) {
    var text = String(content || "").trim();
    if (!text) throw new Error("模型返回了空内容");
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("模型返回的不是有效 JSON");
    var data;
    try {
      data = JSON.parse(text.slice(start, end + 1));
    } catch (error) {
      throw new Error("模型返回的 JSON 解析失败");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("模型返回的 JSON 不是对象");
    }
    return data;
  }

  function collectEntityInput(value, allowedTypes) {
    var items = [];
    if (Array.isArray(value)) {
      items = value;
    } else if (value && typeof value === "object") {
      Object.keys(value).forEach(function (key) {
        if (!Array.isArray(value[key])) return;
        var type = normalizeEntityType(key);
        value[key].forEach(function (item) {
          if (item && typeof item === "object" && !item.type && type) {
            items.push({
              type: type,
              name: item.name,
              aliases: item.aliases,
              note: item.note,
              role: item.role,
              faction: item.faction,
              function: item.function,
              owner: item.owner,
              chapter: item.chapter,
              setup: item.setup,
              payoff: item.payoff,
              status: item.status,
              importance: item.importance,
            });
          } else {
            items.push(item);
          }
        });
      });
    }
    var result = [];
    items.forEach(function (item) {
      var entity = normalizeEntity(item, allowedTypes);
      if (entity) result.push(entity);
    });
    return result;
  }

  function normalizeChapterPayload(data, categories) {
    var summary = toText(data.summary).trim();
    var events = [];
    if (Array.isArray(data.events)) {
      data.events.forEach(function (event) {
        var value = toText(event).trim();
        if (value && events.indexOf(value) < 0) events.push(value);
      });
    }
    var keyExcerpts = normalizeKeyExcerpts(data.keyExcerpts);
    var entities = collectEntityInput(data.entities, selectedEntityTypes(categories));
    if (!summary && !events.length && !keyExcerpts.length && !entities.length) {
      throw new Error("模型返回内容为空");
    }
    return {
      summary: summary,
      events: events,
      keyExcerpts: keyExcerpts,
      entities: entities,
    };
  }

  function arrayFromCategory(data, category) {
    var type = ENTITY_CATEGORY[category];
    var candidates = [data[category], data[type + "s"], data[type]];
    for (var i = 0; i < candidates.length; i += 1) {
      var value = candidates[i];
      if (Array.isArray(value)) return value;
      if (value && typeof value === "object") {
        var nested = [];
        Object.keys(value).forEach(function (key) {
          if (Array.isArray(value[key])) nested = nested.concat(value[key]);
        });
        if (nested.length) return nested;
      }
    }
    return [];
  }

  function normalizeCategoryPayload(data, categories) {
    var root =
      data && data.encyclopedia && typeof data.encyclopedia === "object"
        ? data.encyclopedia
        : data || {};
    var result = emptyEncyclopedia();
    ENCYCLOPEDIA_KEYS.forEach(function (category) {
      if (!categoryEnabled(categories, category)) return;
      result[category] = dedupeEntityList(category, arrayFromCategory(root, category));
    });
    return result;
  }

  function normalizeVolumePayload(data, categories) {
    var summary = toText(data.volumeSummary || data.summary).trim();
    var outline = categoryEnabled(categories, "outline")
      ? normalizeVolumeOutline(data.outline)
      : null;
    var encyclopedia = normalizeCategoryPayload(data, categories);
    if (!summary && !outline && !hasEncyclopediaData(encyclopedia)) {
      throw new Error("模型返回内容为空");
    }
    return { summary: summary, outline: outline, encyclopedia: encyclopedia };
  }

  function normalizeBookPayload(data, categories) {
    var outline = categoryEnabled(categories, "outline")
      ? normalizeBookOutline(data.outline)
      : null;
    var encyclopedia = normalizeCategoryPayload(data, categories);
    if (!outline && !hasEncyclopediaData(encyclopedia)) {
      throw new Error("模型返回内容为空");
    }
    return { outline: outline, encyclopedia: encyclopedia };
  }

  function httpError(status, body) {
    var detail = "";
    try {
      var data = JSON.parse(body);
      detail =
        (data && data.error && (data.error.message || data.error.code)) ||
        (data && data.message) ||
        "";
    } catch (error) {
      detail = String(body || "").replace(/\s+/g, " ").trim().slice(0, 160);
    }
    var message;
    if (status === 401) message = "认证失败（401）：请检查 API Key";
    else if (status === 403) message = "没有访问权限（403）";
    else if (status === 404) message = "接口不存在（404）：请检查 Base URL";
    else if (status === 429) message = "请求过于频繁或额度不足（429）";
    else if (status >= 500) message = "服务端错误（" + status + "）";
    else message = "请求失败（" + status + "）";
    if (detail) message += "；" + toText(detail);
    var error = new Error(message);
    error.httpStatus = status;
    return error;
  }

  function normalizeRequestError(error, timedOut) {
    if (error && error.httpStatus) return error;
    if (timedOut) return new Error("请求超时（90 秒）");
    if (error && error.name === "AbortError") return new Error("请求已取消");
    if (error instanceof TypeError) {
      return new Error("网络请求失败：可能是 CORS 限制、地址不可达或 Ollama 未启动");
    }
    return new Error((error && error.message) || "请求失败");
  }

  function requestChat(config, messages, options) {
    var settings = options || {};
    return new Promise(function (resolve, reject) {
      if (typeof window.fetch !== "function") {
        reject(new Error("当前浏览器不支持 fetch"));
        return;
      }
      var endpoint = endpointOf(config.baseUrl);
      if (!/^https?:\/\//i.test(endpoint)) {
        reject(new Error("Base URL 需以 http:// 或 https:// 开头"));
        return;
      }

      var headers = { "Content-Type": "application/json" };
      var key = String(config.apiKey || "").trim();
      if (key) headers.Authorization = "Bearer " + key;

      var controller = new AbortController();
      var timedOut = false;
      var settled = false;
      var timer = setTimeout(function () {
        timedOut = true;
        controller.abort();
      }, TIMEOUT_MS);

      function finish() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (settings.onController) settings.onController(null);
      }

      if (settings.onController) settings.onController(controller);

      window
        .fetch(endpoint, {
          method: "POST",
          headers: headers,
          body: JSON.stringify({
            model: config.model,
            messages: messages,
            temperature: 0.2,
            max_tokens: settings.maxTokens || 800,
          }),
          signal: controller.signal,
        })
        .then(function (response) {
          if (!response.ok) {
            return response.text().then(function (body) {
              throw httpError(response.status, body);
            });
          }
          return response.json().catch(function () {
            throw new Error("响应不是有效 JSON");
          });
        })
        .then(function (data) {
          var choice = data && data.choices && data.choices[0];
          var content = choice && choice.message && choice.message.content;
          if (Array.isArray(content)) {
            content = content
              .map(function (part) {
                if (typeof part === "string") return part;
                return part && part.text ? String(part.text) : "";
              })
              .join("");
          }
          if (typeof content !== "string" || !content.trim()) {
            throw new Error("响应缺少 choices[0].message.content");
          }
          finish();
          resolve(content);
        })
        .catch(function (error) {
          finish();
          reject(normalizeRequestError(error, timedOut));
        });
    });
  }

  function requestChapterAnalysis(config, chapter, categories, options) {
    var settings = options || {};
    return requestChat(config, chapterPrompt(chapter, categories), {
      maxTokens: 800,
      onController: settings.onController,
    }).then(function (content) {
      return normalizeChapterPayload(parseJsonContent(content), categories);
    });
  }

  function requestVolumeMerge(config, volume, entries, categories, options) {
    var settings = options || {};
    return requestChat(config, volumePrompt(volume, entries, categories), {
      maxTokens: 1200,
      onController: settings.onController,
    }).then(function (content) {
      return normalizeVolumePayload(parseJsonContent(content), categories);
    });
  }

  function requestBookMerge(config, book, volumeEntries, categories, options) {
    var settings = options || {};
    return requestChat(config, bookPrompt(book, volumeEntries, categories), {
      maxTokens: 2000,
      onController: settings.onController,
    }).then(function (content) {
      return normalizeBookPayload(parseJsonContent(content), categories);
    });
  }

  function requestSummary(config, scopeTitle, items) {
    var text = truncate(items.join("\n\n"), MAX_SUMMARY_INPUT);
    var messages = [
      { role: "system", content: "你是小说拆解助手。严格只输出 JSON，不要 Markdown 代码块。" },
      {
        role: "user",
        content:
          "以下是" + scopeTitle + "的已有摘要。请汇总为 200 字以内的整体摘要，" +
          '只输出 {"summary":"..."}。\n\n' + text,
      },
    ];
    return requestChat(config, messages, { maxTokens: 800 }).then(function (content) {
      var data = parseJsonContent(content);
      var summary = toText(data.summary).trim();
      if (!summary) throw new Error("模型未返回摘要");
      return summary;
    });
  }

  function downloadText(fileName, text, mime) {
    var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    if (typeof ND.downloadBlob === "function") {
      ND.downloadBlob(fileName, blob);
      return;
    }
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function safeFileName(value, fallback) {
    if (typeof ND.safeFileName === "function") return ND.safeFileName(value, fallback);
    return String(value || fallback || "未命名").replace(/[\\/:*?"<>|]/g, "_");
  }

  function markdownCell(value) {
    var text = toText(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
    return text || "—";
  }

  function markdownTable(headers, rows) {
    var lines = [
      "| " + headers.join(" | ") + " |",
      "| " + headers.map(function () { return "---"; }).join(" | ") + " |",
    ];
    rows.forEach(function (row) {
      lines.push("| " + row.map(markdownCell).join(" | ") + " |");
    });
    return lines;
  }

  function buildMarkdown(book, results, categories) {
    var lines = [];
    lines.push("# 《" + bookTitle(book) + "》AI 分析");
    lines.push("");
    lines.push(
      "> 导出时间：" + formatTime(new Date().toISOString()) +
      " · 类别：" + categories.map(function (key) { return CATEGORY_LABELS[key]; }).join("、"),
    );
    lines.push("");

    lines.push("## 大纲");
    lines.push("");
    var outline = results.outline;
    if (!outline) {
      lines.push("（暂无）");
    } else {
      if (outline.logline) lines.push("**一句话**：" + outline.logline, "");
      if (outline.synopsis) {
        lines.push("### 梗概", "", outline.synopsis, "");
      }
      if (outline.themes.length) {
        lines.push("### 主题", "");
        outline.themes.forEach(function (theme) { lines.push("- " + theme); });
        lines.push("");
      }
      if (outline.arcs.length) {
        lines.push("### 分卷 / 阶段", "");
        outline.arcs.forEach(function (arc) {
          lines.push("#### " + (arc.title || "未命名阶段"), "");
          if (arc.summary) lines.push(arc.summary, "");
          if (arc.keyEvents.length) {
            lines.push("关键事件：");
            arc.keyEvents.forEach(function (event) { lines.push("- " + event); });
            lines.push("");
          }
          if (arc.chapters) lines.push("章节：" + arc.chapters, "");
        });
      }
    }
    lines.push("");

    var encyclopedia = results.encyclopedia || emptyEncyclopedia();

    function appendTable(title, headers, rows) {
      lines.push("## " + title);
      lines.push("");
      if (!rows.length) lines.push("（暂无）");
      else markdownTable(headers, rows).forEach(function (line) { lines.push(line); });
      lines.push("");
    }

    appendTable(
      "人物",
      ["姓名", "别名", "身份/作用", "阵营", "描述", "弧线", "首次出现", "重要度"],
      encyclopedia.characters.map(function (item) {
        return [
          item.name, (item.aliases || []).join("、"), item.role, item.faction,
          item.description, item.arc, item.firstChapter, item.importance,
        ];
      }),
    );
    appendTable(
      "物品",
      ["名称", "类型", "作用", "归属", "首次出现", "描述"],
      encyclopedia.items.map(function (item) {
        return [item.name, item.type, item.function, item.owner, item.firstChapter, item.description];
      }),
    );
    appendTable(
      "地点",
      ["名称", "类型", "首次出现", "描述"],
      encyclopedia.places.map(function (item) {
        return [item.name, item.type, item.firstChapter, item.description];
      }),
    );
    appendTable(
      "势力",
      ["名称", "类型", "首次出现", "描述"],
      encyclopedia.factions.map(function (item) {
        return [item.name, item.type, item.firstChapter, item.description];
      }),
    );
    appendTable(
      "事件",
      ["名称", "章节", "描述", "意义"],
      encyclopedia.events.map(function (item) {
        return [item.name, item.chapter, item.description, item.significance];
      }),
    );
    appendTable(
      "伏笔",
      ["名称", "埋设", "回收", "状态", "描述"],
      encyclopedia.foreshadows.map(function (item) {
        return [item.name, item.setup, item.payoff, item.status, item.description];
      }),
    );

    var chapterEntries = [];
    (book.chapters || []).forEach(function (chapter) {
      var item = results.chapters[chapter.id];
      if (item) chapterEntries.push({ chapter: chapter, item: item });
    });
    if (chapterEntries.length) {
      lines.push("## 章节摘要");
      lines.push("");
      chapterEntries.forEach(function (entry) {
        lines.push("### " + chapterTitle(entry.chapter), "");
        if (entry.item.error) lines.push("> 错误：" + entry.item.error, "");
        if (entry.item.summary) lines.push(entry.item.summary, "");
        if (entry.item.events.length) {
          lines.push("关键事件：");
          entry.item.events.forEach(function (event) { lines.push("- " + event); });
          lines.push("");
        }
        if (entry.item.keyExcerpts.length) {
          lines.push("关键原文：");
          entry.item.keyExcerpts.forEach(function (excerpt) { lines.push("- " + excerpt); });
          lines.push("");
        }
        if (entry.item.entities.length) {
          lines.push(
            "实体：" + entry.item.entities.map(function (entity) {
              return TYPE_LABELS[entity.type] + "·" + entity.name;
            }).join("、"),
            "",
          );
        }
      });
    }

    return lines.join("\n");
  }

  function buildSkeleton(el) {
    var options = PRESET_ORDER.map(function (key) {
      return '<option value="' + key + '">' + PRESETS[key].label + "</option>";
    }).join("");

    var categoryOptions = CATEGORY_ORDER.map(function (key) {
      return (
        '<label class="ai-category"><input type="checkbox" data-category="' + key + '" checked /> ' +
        CATEGORY_LABELS[key] + "</label>"
      );
    }).join("");

    el.innerHTML =
      '<div class="ai-view">' +
        '<div class="ai-column">' +
          '<section class="ai-block ai-config">' +
            '<div class="ai-block-head">' +
              "<div><h3>模型配置</h3>" +
              '<p class="hint">OpenAI 兼容接口，手动触发。Key 只保存在本机浏览器。</p></div>' +
            "</div>" +
            '<div class="ai-preset-row">' +
              '<label class="field"><span>预设</span>' +
                '<select data-role="preset"><option value="">选择预设…</option>' + options + "</select>" +
              "</label>" +
            "</div>" +
            '<div class="ai-config-grid">' +
              '<label class="field ai-field-wide"><span>Base URL</span>' +
                '<input data-role="baseUrl" spellcheck="false" autocomplete="off" ' +
                'placeholder="https://api.openai.com/v1" />' +
              "</label>" +
              '<label class="field"><span>模型</span>' +
                '<input data-role="model" spellcheck="false" autocomplete="off" placeholder="gpt-4o-mini" />' +
              "</label>" +
              '<label class="field"><span>API Key</span>' +
                '<input data-role="apiKey" type="password" spellcheck="false" autocomplete="off" ' +
                'placeholder="Ollama 可留空" />' +
              "</label>" +
            "</div>" +
            '<label class="option ai-skip"><input type="checkbox" data-role="skipExcluded" checked /> ' +
              "跳过已排除章节</label>" +
            '<div class="ai-categories">' +
              '<span class="ai-category-title">生成类别</span>' +
              '<div class="ai-category-grid">' + categoryOptions + "</div>" +
              '<p class="hint">逐章分析按勾选抽取实体；“大纲”控制分卷与全书大纲。默认全选，修改即保存。</p>' +
            "</div>" +
            '<div class="actions ai-config-actions">' +
              '<button class="primary" data-role="save">保存配置</button>' +
              '<button data-role="test">测试连接</button>' +
              '<button data-role="clearKey">清除 Key</button>' +
            "</div>" +
            '<p class="ai-status" data-role="configStatus"></p>' +
          "</section>" +
          '<section class="ai-block ai-range">' +
            '<div class="ai-block-head">' +
              "<div><h3>分析范围</h3>" +
              '<p class="hint">逐章顺序调用，单次最多 50 章。只发送选中章节的标题与正文。</p></div>' +
            "</div>" +
            '<div class="ai-range-row">' +
              '<label class="field"><span>范围</span>' +
                '<select data-role="rangeType">' +
                  '<option value="current">当前章</option>' +
                  '<option value="volume">指定卷</option>' +
                  '<option value="book">全书</option>' +
                "</select>" +
              "</label>" +
              '<label class="field" data-role="volumeField" hidden><span>指定卷</span>' +
                '<select data-role="volume"></select>' +
              "</label>" +
            "</div>" +
            '<div class="ai-range-meta">' +
              '<span data-role="rangeCount">—</span>' +
              '<span data-role="rangeTokens">—</span>' +
            "</div>" +
            '<div class="actions ai-range-actions">' +
              '<button class="primary" data-role="start">逐章分析</button>' +
              '<button data-role="build">生成大纲与设定集</button>' +
              '<button class="danger" data-role="stop" disabled>停止</button>' +
            "</div>" +
            '<p class="ai-status" data-role="rangeStatus"></p>' +
            '<p class="ai-status" data-role="buildStatus"></p>' +
          "</section>" +
        "</div>" +
        '<div class="ai-column">' +
          '<section class="ai-block ai-results">' +
            '<div class="ai-block-head ai-result-head">' +
              "<div><h3>分析结果</h3>" +
                '<p class="hint" data-role="resultMeta">尚未分析。</p></div>' +
              '<div class="actions">' +
                '<button data-role="exportJson">导出 JSON</button>' +
                '<button data-role="exportMd">导出 Markdown</button>' +
                '<button data-role="bookSummary">生成全书摘要</button>' +
                '<button class="danger" data-role="clear">清空本书结果</button>' +
              "</div>" +
            "</div>" +
            '<div class="ai-progress" data-role="progress" hidden>' +
              '<div class="ai-progress-head">' +
                '<strong data-role="progressStatus">分析中</strong>' +
                '<span data-role="progressCount">0 / 0</span>' +
              "</div>" +
              '<div class="ai-progress-bar"><span data-role="progressBar"></span></div>' +
              '<div class="ai-progress-meta">' +
                '<span data-role="progressCurrent"></span>' +
                '<span data-role="progressSummary"></span>' +
              "</div>" +
            "</div>" +
            '<div class="ai-tabs" data-role="tabs" role="tablist"></div>' +
            '<div data-role="tabBody"></div>' +
          "</section>" +
        "</div>" +
      "</div>";
  }

  ND.plugins.register({
    id: "ai-analysis",
    name: "AI 分析",
    version: PLUGIN_VERSION,
    apiVersion: 1,
    priority: 50,
    description:
      "通过 OpenAI 兼容接口逐章生成摘要与关键原文，抽取人物、物品、地点、势力、事件与伏笔，" +
      "按卷归并并汇总为全书大纲与设定集；结果按书保存在本地插件存储，可导出 JSON/Markdown。",
    ui: {
      views: [
        {
          id: "ai",
          label: "AI 分析",
          mount: function (el, ctx) {
            buildSkeleton(el);

            var refs = { categoryInputs: {} };
            Array.prototype.slice.call(el.querySelectorAll("[data-role]")).forEach(function (node) {
              refs[node.dataset.role] = node;
            });
            Array.prototype.slice.call(el.querySelectorAll("[data-category]")).forEach(function (node) {
              refs.categoryInputs[node.dataset.category] = node;
            });

            var storage = ctx.storage;
            var state = {
              book: ctx.getBook(),
              bookKey: "",
              results: emptyResults(),
              progress: {
                phase: "chapter",
                total: 0,
                volumeTotal: 0,
                done: 0,
                success: 0,
                fail: 0,
                current: "",
                status: "idle",
              },
              busy: "",
              cancelRequested: false,
              controller: null,
              session: 0,
              configNotice: null,
              storageWarned: false,
              activeTab: "chapters",
            };

            function currentBook() {
              return ctx.getBook();
            }

            function isCurrentBook(key) {
              var book = currentBook();
              return !!book && bookStorageKey(book) === key;
            }

            function readCategories() {
              return CATEGORY_ORDER.filter(function (key) {
                var input = refs.categoryInputs[key];
                return !!(input && input.checked);
              });
            }

            function readConfigInputs() {
              return {
                preset: refs.preset.value,
                baseUrl: refs.baseUrl.value.trim(),
                model: refs.model.value.trim(),
                apiKey: refs.apiKey.value,
                skipExcluded: refs.skipExcluded.checked,
                categories: readCategories(),
              };
            }

            function applyCategories(categories) {
              var enabled = {};
              normalizeCategories(categories).forEach(function (key) {
                enabled[key] = true;
              });
              CATEGORY_ORDER.forEach(function (key) {
                if (refs.categoryInputs[key]) {
                  refs.categoryInputs[key].checked = !!enabled[key];
                }
              });
            }

            function applyConfig(config) {
              refs.preset.value = PRESETS[config.preset] ? config.preset : "";
              refs.baseUrl.value = config.baseUrl || "";
              refs.model.value = config.model || "";
              refs.apiKey.value = config.apiKey || "";
              refs.skipExcluded.checked = config.skipExcluded !== false;
              applyCategories(config.categories);
            }

            function renderConfigStatus() {
              if (state.configNotice) {
                setStatus(refs.configStatus, state.configNotice.text, state.configNotice.kind);
                return;
              }
              if (!isConfigured(readConfigInputs())) {
                setStatus(refs.configStatus, "请先配置模型", "warn");
                return;
              }
              var config = readConfigInputs();
              setStatus(
                refs.configStatus,
                "当前模型：" + config.model + (config.apiKey ? "（已填写 Key）" : "（未填写 Key）"),
                "",
              );
            }

            function resetProgress() {
              state.progress = {
                phase: "chapter",
                total: 0,
                volumeTotal: 0,
                done: 0,
                success: 0,
                fail: 0,
                current: "",
                status: "idle",
              };
              renderProgress();
            }

            function updateVolumeField() {
              refs.volumeField.hidden = refs.rangeType.value !== "volume";
            }

            function volumeChapters(volume) {
              var book = currentBook();
              if (!book || !volume) return [];
              if (volume.id === "__all__") return (book.chapters || []).slice();
              var chapters = Array.isArray(volume.chapters) ? volume.chapters : [];
              if (chapters.length) return chapters;
              return (book.chapters || []).filter(function (chapter) {
                return chapter.volumeId === volume.id;
              });
            }

            function rebuildVolumeSelect() {
              var book = currentBook();
              var previous = refs.volume.value;
              clearNode(refs.volume);
              if (!book || !book.volumes || !book.volumes.length) {
                refs.volume.appendChild(makeElement("option", "", "（无卷）"));
                refs.volume.value = "";
                return;
              }
              book.volumes.forEach(function (volume) {
                var option = document.createElement("option");
                option.value = volume.id;
                option.textContent = volumeTitle(volume);
                refs.volume.appendChild(option);
              });
              var exists = Array.prototype.some.call(refs.volume.options, function (option) {
                return option.value === previous;
              });
              refs.volume.value = exists ? previous : book.volumes[0].id;
            }

            function computeRange() {
              var book = currentBook();
              var config = readConfigInputs();
              var scope = refs.rangeType.value;
              var list = [];
              var label = "当前章";
              var error = "";

              if (!book) {
                return { chapters: [], label: label, error: "请先导入一本书", totalChars: 0 };
              }

              if (scope === "current") {
                label = "当前章";
                var selected = ctx.getSelectedChapter();
                if (!selected) {
                  error = "请先在阅读页选择章节";
                } else {
                  list = [selected];
                }
              } else if (scope === "volume") {
                label = "指定卷";
                var volume = (book.volumes || []).find(function (item) {
                  return item.id === refs.volume.value;
                });
                if (!volume) {
                  error = "请选择卷";
                } else {
                  label = volumeTitle(volume);
                  list = volumeChapters(volume).slice();
                }
              } else {
                label = "全书";
                list = (book.chapters || []).slice();
              }

              if (!error && config.skipExcluded) {
                list = list.filter(function (chapter) {
                  return !chapter.excluded;
                });
              }
              if (!error && !list.length) {
                error = config.skipExcluded ? "范围内没有未排除的章节" : "范围内没有章节";
              }
              if (!error && list.length > MAX_CHAPTERS) {
                error = "共 " + list.length + " 章，超过单次上限 50 章，请缩小范围";
              }

              var totalChars = list.reduce(function (sum, chapter) {
                return sum + String(chapter.body || "").length;
              }, 0);

              return {
                chapters: list,
                label: label,
                error: error,
                totalChars: totalChars,
                inputTokens: totalChars ? Math.ceil(totalChars / 2) : 0,
                outputTokens: list.length * 300,
              };
            }

            function renderRange() {
              updateVolumeField();
              var config = readConfigInputs();
              var range = computeRange();
              var total = range.chapters.length;

              refs.rangeCount.textContent = total ? "共 " + total + " 章" : "共 0 章";
              refs.rangeTokens.textContent = total
                ? "预计输入 ≈ " + ND.formatCount(range.inputTokens) + " token · 输出 ≈ " +
                  ND.formatCount(range.outputTokens) + " token"
                : "预计 token：—";

              var message = "";
              var kind = "";
              if (!currentBook()) {
                message = "请先导入一本书";
                kind = "warn";
              } else if (!isConfigured(config)) {
                message = "请先配置模型";
                kind = "warn";
              } else if (!range.chapters.length && range.error) {
                message = range.error;
                kind = "warn";
              } else if (range.error) {
                message = range.error;
                kind = "danger";
              } else if (state.progress.status === "running") {
                message = "正在执行：" + (state.progress.current || "准备中");
              } else {
                message = "范围：" + range.label + " · " + total + " 章，可开始逐章分析";
              }
              if (state.progress.status === "stopped" && !state.busy) {
                message = "已停止，保留已完成的结果";
                kind = "warn";
              }
              setStatus(refs.rangeStatus, message, kind);

              var blocked = !!range.error || !total || !isConfigured(config);
              refs.start.disabled = !!state.busy || blocked;
              refs.stop.disabled = state.busy !== "analyze" && state.busy !== "build";
              refs.rangeType.disabled = !!state.busy;
              refs.volume.disabled = !!state.busy;
            }

            function renderControls() {
              var busy = !!state.busy;
              refs.preset.disabled = busy;
              refs.baseUrl.disabled = busy;
              refs.model.disabled = busy;
              refs.apiKey.disabled = busy;
              refs.skipExcluded.disabled = busy;
              refs.save.disabled = busy;
              refs.test.disabled = busy;
              refs.clearKey.disabled = busy;
              CATEGORY_ORDER.forEach(function (key) {
                if (refs.categoryInputs[key]) refs.categoryInputs[key].disabled = busy;
              });
              renderRange();
              renderResultsActions();
            }

            function setConfigNotice(text, kind) {
              state.configNotice = text ? { text: text, kind: kind || "" } : null;
              renderConfigStatus();
            }

            function persistResults() {
              var key = state.bookKey;
              if (!key) return Promise.resolve();
              state.results.updatedAt = new Date().toISOString();
              return storage.set(key, state.results).catch(function (error) {
                if (!state.storageWarned) {
                  state.storageWarned = true;
                  ctx.toast("AI 结果写入失败：" + ((error && error.message) || "未知错误"));
                }
                throw error;
              });
            }

            function saveResultsQuietly() {
              return persistResults().catch(function () {
                return null;
              });
            }

            function renderProgress() {
              var progress = state.progress;
              var visible = progress.total > 0 && progress.status !== "idle";
              refs.progress.hidden = !visible;
              if (!visible) return;

              var phaseLabel = "逐章分析";
              if (progress.phase === "volume") phaseLabel = "卷归并";
              else if (progress.phase === "book") phaseLabel = "全书汇总";

              var label = phaseLabel + "中";
              if (progress.status === "done") label = "已完成";
              if (progress.status === "stopped") label = "已停止";
              refs.progressStatus.textContent = label;

              if (progress.phase === "volume" && progress.volumeTotal) {
                refs.progressCount.textContent =
                  Math.min(progress.done, progress.volumeTotal) + " / " + progress.volumeTotal;
              } else if (progress.phase === "book") {
                refs.progressCount.textContent = "全书汇总";
              } else {
                refs.progressCount.textContent = progress.done + " / " + progress.total;
              }

              refs.progressBar.style.width =
                (progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0) + "%";
              refs.progressCurrent.textContent =
                progress.status === "running"
                  ? "当前：" + (progress.current || "准备中")
                  : progress.current || "";
              refs.progressSummary.textContent =
                "成功 " + progress.success + " · 失败 " + progress.fail;
            }

            function resultCount() {
              var book = currentBook();
              if (!book) return 0;
              return (book.chapters || []).filter(function (chapter) {
                return !!state.results.chapters[chapter.id];
              }).length;
            }

            function analyzedChapterCount() {
              var book = currentBook();
              if (!book) return 0;
              return (book.chapters || []).filter(function (chapter) {
                var item = state.results.chapters[chapter.id];
                return !!(item && item.summary);
              }).length;
            }

            function hasAnySummary() {
              return analyzedChapterCount() > 0;
            }

            function hasVolumeSummary() {
              return Object.keys(state.results.volumeSummaries || {}).some(function (key) {
                var item = state.results.volumeSummaries[key];
                return !!(item && item.summary);
              });
            }

            function hasAnyChapterResult() {
              return Object.keys(state.results.chapters || {}).length > 0;
            }

            function hasExportData() {
              return (
                hasAnyChapterResult() ||
                !!state.results.outline ||
                hasEncyclopediaData(state.results.encyclopedia) ||
                hasVolumeSummary() ||
                !!(state.results.bookSummary && state.results.bookSummary.summary)
              );
            }

            function analyzedGroups() {
              var book = currentBook();
              if (!book) return [];
              var groups = [];
              var seen = {};
              var volumes =
                Array.isArray(book.volumes) && book.volumes.length
                  ? book.volumes
                  : [{ id: "__all__", title: "全书" }];
              volumes.forEach(function (volume) {
                var chapters = volumeChapters(volume).filter(function (chapter) {
                  var item = state.results.chapters[chapter.id];
                  return !!(item && item.summary);
                });
                if (!chapters.length) return;
                chapters.forEach(function (chapter) { seen[chapter.id] = true; });
                groups.push({
                  volume: volume,
                  entries: chapters.map(function (chapter) {
                    return { chapter: chapter, item: state.results.chapters[chapter.id] };
                  }),
                });
              });
              var orphans = (book.chapters || []).filter(function (chapter) {
                var item = state.results.chapters[chapter.id];
                return !!(item && item.summary) && !seen[chapter.id];
              });
              if (orphans.length) {
                groups.push({
                  volume: { id: "__orphan__", rawTitle: "未分卷章节" },
                  entries: orphans.map(function (chapter) {
                    return { chapter: chapter, item: state.results.chapters[chapter.id] };
                  }),
                });
              }
              return groups;
            }

            function buildEstimate(groups, categories) {
              var chapterCount = 0;
              var volumeChars = 0;
              groups.forEach(function (group) {
                chapterCount += group.entries.length;
                volumeChars += volumeInputText(group.volume, group.entries, categories).length;
              });
              var bookChars = 0;
              var available = 0;
              groups.forEach(function (group) {
                var entry = state.results.volumeSummaries[group.volume.id];
                if (entry && entry.summary) {
                  available += 1;
                  bookChars += formatVolumeEntry(group.volume, entry, categories).length;
                }
              });
              if (!available) bookChars = groups.length * 900;
              return {
                chapters: chapterCount,
                volumes: groups.length,
                volumeInputTokens: Math.ceil(volumeChars / 2),
                volumeOutputTokens: groups.length * 800,
                bookInputTokens: Math.ceil(bookChars / 2),
                bookOutputTokens: 1500,
              };
            }

            function renderResultsActions() {
              var book = currentBook();
              var count = resultCount();
              var meta = "";
              if (!book) {
                meta = "请先导入一本书";
              } else {
                meta = "已分析 " + count + " 章";
                if (state.results.updatedAt) meta += " · 更新于 " + formatTime(state.results.updatedAt);
              }
              refs.resultMeta.textContent = meta;
              refs.clear.disabled = !book || !hasExportData() || !!state.busy;
              refs.bookSummary.disabled =
                !book || !!state.busy || (!hasVolumeSummary() && !hasAnySummary());
              refs.exportJson.disabled = !!state.busy || !hasExportData();
              refs.exportMd.disabled = !!state.busy || !hasExportData();

              var categories = readCategories();
              var groups = analyzedGroups();
              var reason = "";
              if (!book) reason = "请先导入一本书";
              else if (!categories.length) reason = "请至少勾选一个生成类别";
              else if (!groups.length) reason = "请先逐章分析，再生成大纲与设定集";
              refs.build.disabled = !!state.busy || !!reason;
              refs.build.title = reason || "按卷归并后汇总全书大纲与设定集";

              if (reason) {
                setStatus(refs.buildStatus, reason + "。", "warn");
              } else if (state.busy === "build") {
                setStatus(refs.buildStatus, "正在按卷归并并汇总全书…", "");
              } else {
                var estimate = buildEstimate(groups, categories);
                setStatus(
                  refs.buildStatus,
                  "可归并 " + groups.length + " 卷（" + estimate.chapters + " 章摘要） · " +
                  "预计输入 ≈ " + ND.formatCount(estimate.volumeInputTokens + estimate.bookInputTokens) +
                  " token · 输出 ≈ " +
                  ND.formatCount(estimate.volumeOutputTokens + estimate.bookOutputTokens) +
                  " token。生成前会再次确认。",
                  "",
                );
              }
            }

            function appendEntity(parent, entity) {
              var type = ENTITY_TYPES.indexOf(entity.type) >= 0 ? entity.type : "character";
              var chip = makeElement("span", "ai-entity " + type);
              chip.appendChild(makeElement("span", "ai-entity-type", TYPE_LABELS[type]));
              chip.appendChild(makeElement("span", "ai-entity-name", entity.name));
              if (entity.aliases && entity.aliases.length) {
                chip.appendChild(
                  makeElement("span", "ai-entity-alias", "（" + entity.aliases.join("、") + "）"),
                );
              }
              if (entity.note) {
                chip.appendChild(makeElement("span", "ai-entity-note", " · " + entity.note));
              }
              parent.appendChild(chip);
            }

            function renderChapterResult(chapter, item) {
              var card = makeElement("article", "ai-result");
              var head = makeElement("div", "ai-result-head");
              head.appendChild(makeElement("h4", "", chapterTitle(chapter)));
              var meta = makeElement("span", "ai-result-time", formatTime(item.at));
              if (item.model) meta.textContent = item.model + (meta.textContent ? " · " + meta.textContent : "");
              head.appendChild(meta);
              card.appendChild(head);

              if (item.error) {
                card.appendChild(makeElement("p", "ai-error", item.error));
              }
              if (item.summary) {
                card.appendChild(makeElement("p", "ai-summary", item.summary));
              }
              if (item.events && item.events.length) {
                var eventBox = makeElement("div", "ai-events");
                eventBox.appendChild(makeElement("strong", "", "关键事件"));
                var list = document.createElement("ul");
                item.events.forEach(function (event) {
                  list.appendChild(makeElement("li", "", event));
                });
                eventBox.appendChild(list);
                card.appendChild(eventBox);
              }
              if (item.keyExcerpts && item.keyExcerpts.length) {
                var excerptBox = makeElement("div", "ai-excerpts");
                excerptBox.appendChild(makeElement("strong", "", "关键原文"));
                var excerptList = document.createElement("ul");
                item.keyExcerpts.forEach(function (excerpt) {
                  excerptList.appendChild(makeElement("li", "", excerpt));
                });
                excerptBox.appendChild(excerptList);
                card.appendChild(excerptBox);
              }
              if (item.entities && item.entities.length) {
                var tags = makeElement("div", "ai-entities");
                item.entities.forEach(function (entity) {
                  appendEntity(tags, entity);
                });
                card.appendChild(tags);
              }
              if (!item.summary && !item.error && !(item.events && item.events.length) &&
                  !(item.keyExcerpts && item.keyExcerpts.length) &&
                  !(item.entities && item.entities.length)) {
                card.appendChild(makeElement("p", "ai-empty", "该章没有可用结果"));
              }
              return card;
            }

            function appendBookSummary(container) {
              var item = state.results.bookSummary;
              if (!item || !item.summary) return;
              var box = makeElement("div", "ai-book-summary");
              var head = makeElement("div", "ai-book-summary-head");
              head.appendChild(makeElement("h4", "", "全书摘要"));
              head.appendChild(makeElement("span", "ai-result-time", formatTime(item.at)));
              box.appendChild(head);
              box.appendChild(makeElement("p", "ai-summary", item.summary));
              container.appendChild(box);
            }

            function countEncyclopedia(entry) {
              if (!entry || !entry.entities) return "";
              var parts = [];
              ENCYCLOPEDIA_KEYS.forEach(function (key) {
                var count = (entry.entities[key] || []).length;
                if (count) parts.push(CATEGORY_LABELS[key] + " " + count);
              });
              return parts.join(" · ");
            }

            function appendVolumes(container) {
              var book = currentBook();
              if (!book) return;
              (book.volumes || []).forEach(function (volume) {
                var chapters = volumeChapters(volume);
                var analyzed = chapters.filter(function (chapter) {
                  var item = state.results.chapters[chapter.id];
                  return !!(item && item.summary);
                }).length;
                var summary = state.results.volumeSummaries[volume.id];
                if (!analyzed && !(summary && (summary.summary || summary.error))) return;

                var row = makeElement("article", "ai-volume-row");
                var head = makeElement("div", "ai-volume-head");
                var info = makeElement("div", "ai-volume-info");
                info.appendChild(makeElement("strong", "", volumeTitle(volume)));
                info.appendChild(
                  makeElement("span", "hint", "已分析 " + analyzed + " 章 / 共 " + chapters.length + " 章"),
                );
                head.appendChild(info);
                var button = makeElement("button", "", "生成卷摘要");
                button.disabled = !!state.busy || analyzed === 0;
                button.onclick = function () {
                  generateVolumeSummary(volume.id);
                };
                head.appendChild(button);
                row.appendChild(head);

                if (summary && summary.error) {
                  row.appendChild(makeElement("p", "ai-error", "卷归并失败：" + summary.error));
                }
                if (summary && summary.summary) {
                  row.appendChild(makeElement("p", "ai-summary", summary.summary));
                  row.appendChild(makeElement("span", "ai-result-time", formatTime(summary.at)));
                } else if (!summary || !summary.error) {
                  row.appendChild(makeElement("p", "ai-empty", "尚未生成卷摘要。"));
                }
                if (summary && summary.outline) {
                  var outlineBox = makeElement("div", "ai-volume-outline");
                  outlineBox.appendChild(makeElement("strong", "", "卷大纲"));
                  outlineBox.appendChild(makeElement("p", "ai-summary", summary.outline.summary || "（无）"));
                  if (summary.outline.keyEvents.length) {
                    var list = document.createElement("ul");
                    summary.outline.keyEvents.forEach(function (event) {
                      list.appendChild(makeElement("li", "", event));
                    });
                    outlineBox.appendChild(list);
                  }
                  row.appendChild(outlineBox);
                }
                var counts = countEncyclopedia(summary);
                if (counts) {
                  row.appendChild(makeElement("p", "ai-empty", "卷级设定集：" + counts));
                }
                container.appendChild(row);
              });
            }

            function renderChaptersTab(container) {
              appendBookSummary(container);
              appendVolumes(container);
              var book = currentBook();
              if (!book) {
                container.appendChild(makeElement("div", "empty", "导入一本书后开始分析。"));
                return;
              }
              var shown = 0;
              (book.chapters || []).forEach(function (chapter) {
                var item = state.results.chapters[chapter.id];
                if (!item) return;
                shown += 1;
                container.appendChild(renderChapterResult(chapter, item));
              });
              if (!shown) {
                container.appendChild(
                  makeElement("div", "empty", "尚无章节分析结果。选择范围后点击“逐章分析”。"),
                );
              }
            }

            function outlineEmptyText() {
              return hasAnySummary()
                ? "尚未生成全书大纲。点击“生成大纲与设定集”汇总。"
                : "尚无大纲。请先完成逐章分析。";
            }

            function renderOutlineTab(container) {
              var outline = state.results.outline;
              if (!outline) {
                container.appendChild(makeElement("p", "ai-empty", outlineEmptyText()));
                return;
              }
              var card = makeElement("article", "ai-outline");
              var head = makeElement("div", "ai-result-head");
              head.appendChild(makeElement("h4", "", "全书大纲"));
              var meta = [];
              if (outline.model) meta.push(outline.model);
              if (outline.at) meta.push(formatTime(outline.at));
              head.appendChild(makeElement("span", "ai-result-time", meta.join(" · ")));
              card.appendChild(head);

              if (outline.logline) {
                var logline = makeElement("p", "ai-logline");
                logline.appendChild(makeElement("span", "ai-logline-label", "一句话"));
                logline.appendChild(makeElement("span", "", outline.logline));
                card.appendChild(logline);
              }
              if (outline.synopsis) {
                var section = makeElement("section", "ai-outline-section");
                section.appendChild(makeElement("h5", "", "梗概"));
                section.appendChild(makeElement("p", "ai-summary", outline.synopsis));
                card.appendChild(section);
              }
              if (outline.themes.length) {
                var themeSection = makeElement("section", "ai-outline-section");
                themeSection.appendChild(makeElement("h5", "", "主题"));
                var chips = makeElement("div", "ai-chips");
                outline.themes.forEach(function (theme) {
                  chips.appendChild(makeElement("span", "ai-chip", theme));
                });
                themeSection.appendChild(chips);
                card.appendChild(themeSection);
              }
              if (outline.arcs.length) {
                var arcSection = makeElement("section", "ai-outline-section");
                arcSection.appendChild(makeElement("h5", "", "分卷 / 阶段"));
                outline.arcs.forEach(function (arc) {
                  var arcBox = makeElement("article", "ai-arc");
                  arcBox.appendChild(makeElement("h6", "", arc.title || "未命名阶段"));
                  if (arc.summary) arcBox.appendChild(makeElement("p", "ai-summary", arc.summary));
                  if (arc.keyEvents.length) {
                    var events = makeElement("div", "ai-events");
                    events.appendChild(makeElement("strong", "", "关键事件"));
                    var list = document.createElement("ul");
                    arc.keyEvents.forEach(function (event) {
                      list.appendChild(makeElement("li", "", event));
                    });
                    events.appendChild(list);
                    arcBox.appendChild(events);
                  }
                  if (arc.chapters) {
                    arcBox.appendChild(makeElement("p", "ai-empty", "章节：" + arc.chapters));
                  }
                  arcSection.appendChild(arcBox);
                });
                card.appendChild(arcSection);
              }
              container.appendChild(card);
            }

            function fieldValue(item, key, join) {
              var value = item[key];
              if (join && Array.isArray(value)) return value.join("、");
              return toText(value);
            }

            function renderEntityGroup(container, category, list, emptyText) {
              if (!list.length) {
                container.appendChild(makeElement("p", "ai-empty", emptyText));
                return;
              }
              var grid = makeElement("div", "ai-entity-grid");
              var fields = ENTITY_FIELDS[category] || [];
              list.forEach(function (item) {
                var card = makeElement("article", "ai-entity-card");
                card.appendChild(makeElement("h5", "", item.name));
                var body = makeElement("div", "ai-entity-fields");
                fields.forEach(function (field) {
                  var value = fieldValue(item, field[0], field[2]);
                  if (!value) return;
                  var row = makeElement("div", "ai-entity-field");
                  row.appendChild(makeElement("span", "ai-entity-field-label", field[1]));
                  row.appendChild(makeElement("span", "ai-entity-field-value", value));
                  body.appendChild(row);
                });
                card.appendChild(body);
                grid.appendChild(card);
              });
              container.appendChild(grid);
            }

            function renderCharactersTab(container) {
              var list = state.results.encyclopedia.characters;
              renderEntityGroup(
                container,
                "characters",
                list,
                hasAnySummary()
                  ? "尚无人物数据。勾选“人物”后点击“生成大纲与设定集”。"
                  : "尚无人物数据。请先完成逐章分析。",
              );
            }

            function renderItemsTab(container) {
              var list = state.results.encyclopedia.items;
              renderEntityGroup(
                container,
                "items",
                list,
                hasAnySummary()
                  ? "尚无物品数据。勾选“物品/道具”后点击“生成大纲与设定集”。"
                  : "尚无物品数据。请先完成逐章分析。",
              );
            }

            function renderPlacesTab(container) {
              var encyclopedia = state.results.encyclopedia;
              var places = makeElement("section", "ai-entity-section");
              places.appendChild(makeElement("h5", "", "地点"));
              renderEntityGroup(
                places,
                "places",
                encyclopedia.places,
                hasAnySummary() ? "尚无地点数据。" : "尚无地点数据。请先完成逐章分析。",
              );
              container.appendChild(places);

              var factions = makeElement("section", "ai-entity-section");
              factions.appendChild(makeElement("h5", "", "势力"));
              renderEntityGroup(
                factions,
                "factions",
                encyclopedia.factions,
                hasAnySummary() ? "尚无势力数据。" : "尚无势力数据。请先完成逐章分析。",
              );
              container.appendChild(factions);
            }

            function renderEventsTab(container) {
              var encyclopedia = state.results.encyclopedia;
              var events = makeElement("section", "ai-entity-section");
              events.appendChild(makeElement("h5", "", "事件"));
              renderEntityGroup(
                events,
                "events",
                encyclopedia.events,
                hasAnySummary() ? "尚无事件数据。" : "尚无事件数据。请先完成逐章分析。",
              );
              container.appendChild(events);

              var foreshadows = makeElement("section", "ai-entity-section");
              foreshadows.appendChild(makeElement("h5", "", "伏笔"));
              renderEntityGroup(
                foreshadows,
                "foreshadows",
                encyclopedia.foreshadows,
                hasAnySummary() ? "尚无伏笔数据。" : "尚无伏笔数据。请先完成逐章分析。",
              );
              container.appendChild(foreshadows);
            }

            function tabDefinitions() {
              var categories = readCategories();
              var encyclopedia = state.results.encyclopedia;
              var defs = [{ id: "chapters", label: "章节摘要", visible: true }];
              var showOutline =
                categoryEnabled(categories, "outline") || !!state.results.outline;
              var showCharacters =
                categoryEnabled(categories, "characters") || encyclopedia.characters.length > 0;
              var showItems =
                categoryEnabled(categories, "items") || encyclopedia.items.length > 0;
              var showPlaces =
                categoryEnabled(categories, "places") ||
                categoryEnabled(categories, "factions") ||
                encyclopedia.places.length > 0 ||
                encyclopedia.factions.length > 0;
              var showEvents =
                categoryEnabled(categories, "events") ||
                categoryEnabled(categories, "foreshadows") ||
                encyclopedia.events.length > 0 ||
                encyclopedia.foreshadows.length > 0;
              if (showOutline) defs.push({ id: "outline", label: "大纲", visible: true });
              if (showCharacters) defs.push({ id: "characters", label: "人物", visible: true });
              if (showItems) defs.push({ id: "items", label: "物品", visible: true });
              if (showPlaces) defs.push({ id: "places", label: "地点势力", visible: true });
              if (showEvents) defs.push({ id: "events", label: "事件伏笔", visible: true });
              return defs;
            }

            function renderTabs() {
              var defs = tabDefinitions();
              var visible = {};
              defs.forEach(function (def) { visible[def.id] = true; });
              if (!visible[state.activeTab]) state.activeTab = "chapters";

              clearNode(refs.tabs);
              defs.forEach(function (def) {
                var button = makeElement(
                  "button",
                  "ai-tab" + (state.activeTab === def.id ? " active" : ""),
                  def.label,
                );
                button.setAttribute("role", "tab");
                button.setAttribute("aria-selected", state.activeTab === def.id ? "true" : "false");
                button.onclick = function () {
                  state.activeTab = def.id;
                  renderTabs();
                  renderTabBody();
                };
                refs.tabs.appendChild(button);
              });
            }

            function renderTabBody() {
              clearNode(refs.tabBody);
              if (state.activeTab === "outline") renderOutlineTab(refs.tabBody);
              else if (state.activeTab === "characters") renderCharactersTab(refs.tabBody);
              else if (state.activeTab === "items") renderItemsTab(refs.tabBody);
              else if (state.activeTab === "places") renderPlacesTab(refs.tabBody);
              else if (state.activeTab === "events") renderEventsTab(refs.tabBody);
              else renderChaptersTab(refs.tabBody);
            }

            function renderResults() {
              renderTabs();
              renderTabBody();
              renderResultsActions();
            }

            function buildExportJson() {
              var book = currentBook();
              var chapters = [];
              (book.chapters || []).forEach(function (chapter) {
                var item = state.results.chapters[chapter.id];
                if (!item) return;
                chapters.push({
                  id: chapter.id,
                  title: item.title || chapterTitle(chapter),
                  summary: item.summary,
                  events: item.events,
                  keyExcerpts: item.keyExcerpts,
                  entities: item.entities,
                  model: item.model,
                  at: item.at,
                  error: item.error,
                });
              });
              var volumes = [];
              (book.volumes || []).forEach(function (volume) {
                var item = state.results.volumeSummaries[volume.id];
                if (!item) return;
                volumes.push({
                  id: volume.id,
                  title: volumeTitle(volume),
                  summary: item.summary,
                  outline: item.outline,
                  entities: item.entities,
                  at: item.at,
                  error: item.error,
                });
              });
              return {
                format: "novel-disassembly-ai-analysis",
                version: PLUGIN_VERSION,
                exportedAt: new Date().toISOString(),
                categories: readCategories(),
                book: { title: bookTitle(book), fileName: book.fileName || "" },
                outline: state.results.outline,
                encyclopedia: state.results.encyclopedia,
                chapters: chapters,
                volumeSummaries: volumes,
                bookSummary: state.results.bookSummary,
                entityMeta: state.results.entityMeta,
              };
            }

            function exportJson() {
              if (state.busy || !currentBook() || !hasExportData()) return;
              var book = currentBook();
              var fileName = safeFileName(
                bookTitle(book) + "-AI分析-" + stampNow(),
                "AI分析",
              ) + ".json";
              downloadText(
                fileName,
                JSON.stringify(buildExportJson(), null, 2),
                "application/json;charset=utf-8",
              );
              ctx.toast("已导出 " + fileName);
            }

            function exportMarkdown() {
              if (state.busy || !currentBook() || !hasExportData()) return;
              var book = currentBook();
              var fileName = safeFileName(
                bookTitle(book) + "-AI分析-" + stampNow(),
                "AI分析",
              ) + ".md";
              downloadText(
                fileName,
                buildMarkdown(book, state.results, readCategories()),
                "text/markdown;charset=utf-8",
              );
              ctx.toast("已导出 " + fileName);
            }

            function applyLoadedResults(results, key) {
              if (!isCurrentBook(key)) return;
              state.results = normalizeResults(results);
              renderResults();
              renderProgress();
            }

            function refreshBook() {
              state.book = currentBook();
              state.bookKey = bookStorageKey(state.book);
              state.progress = {
                phase: "chapter",
                total: 0,
                volumeTotal: 0,
                done: 0,
                success: 0,
                fail: 0,
                current: "",
                status: "idle",
              };
              state.activeTab = "chapters";
              rebuildVolumeSelect();
              renderProgress();
              if (!state.book || !state.bookKey) {
                state.results = emptyResults();
                renderResults();
                renderRange();
                return Promise.resolve();
              }
              var key = state.bookKey;
              return storage
                .get(key, emptyResults())
                .then(function (results) {
                  applyLoadedResults(results, key);
                  renderRange();
                })
                .catch(function (error) {
                  if (!isCurrentBook(key)) return;
                  state.results = emptyResults();
                  renderResults();
                  renderRange();
                  ctx.toast("读取 AI 结果失败：" + ((error && error.message) || "未知错误"));
                });
            }

            function saveConfig() {
              var config = readConfigInputs();
              refs.save.disabled = true;
              storage
                .set("config", config)
                .then(function () {
                  setConfigNotice("配置已保存", "success");
                  ctx.toast("AI 配置已保存");
                })
                .catch(function (error) {
                  setConfigNotice(
                    "配置保存失败：" + ((error && error.message) || "未知错误"),
                    "danger",
                  );
                })
                .then(function () {
                  renderControls();
                });
            }

            function saveCategories() {
              if (!el.isConnected) return;
              var config = readConfigInputs();
              storage
                .set("config", config)
                .then(function () {
                  state.configNotice = null;
                  renderConfigStatus();
                })
                .catch(function (error) {
                  setConfigNotice(
                    "类别保存失败：" + ((error && error.message) || "未知错误"),
                    "danger",
                  );
                });
              renderRange();
              renderResults();
            }

            function clearKey() {
              refs.apiKey.value = "";
              var config = readConfigInputs();
              config.apiKey = "";
              refs.clearKey.disabled = true;
              storage
                .set("config", config)
                .then(function () {
                  setConfigNotice("已清除 API Key 并保存配置", "success");
                  ctx.toast("已清除 API Key");
                })
                .catch(function (error) {
                  setConfigNotice(
                    "清除失败：" + ((error && error.message) || "未知错误"),
                    "danger",
                  );
                })
                .then(function () {
                  renderControls();
                });
            }

            function testConnection() {
              var config = readConfigInputs();
              if (!isConfigured(config)) {
                setConfigNotice("请先填写 Base URL 与模型", "warn");
                return;
              }
              state.busy = "test";
              renderControls();
              setConfigNotice("正在测试连接…", "");
              refs.test.textContent = "测试中…";
              requestChat(config, [{ role: "user", content: "回复 OK" }], { maxTokens: 8 })
                .then(function (content) {
                  setConfigNotice("连接成功：" + truncate(content.trim(), 60), "success");
                  ctx.toast("连接成功");
                })
                .catch(function (error) {
                  setConfigNotice("连接失败：" + ((error && error.message) || "未知错误"), "danger");
                })
                .then(function () {
                  state.busy = "";
                  refs.test.textContent = "测试连接";
                  renderControls();
                });
            }

            function failEntry(chapter, config, error) {
              return {
                title: chapterTitle(chapter),
                summary: "",
                events: [],
                keyExcerpts: [],
                entities: [],
                model: config.model,
                at: new Date().toISOString(),
                error: (error && error.message) || "分析失败",
              };
            }

            async function analyze() {
              if (state.busy) return;
              var config = readConfigInputs();
              if (!isConfigured(config)) {
                setConfigNotice("请先配置模型", "warn");
                return;
              }
              var range = computeRange();
              if (range.error || !range.chapters.length) {
                renderRange();
                return;
              }
              var book = currentBook();
              var bookKey = bookStorageKey(book);
              if (!book || !bookKey) {
                ctx.toast("请先导入一本书");
                return;
              }
              var categories = readCategories();
              var categoryText = categories.length
                ? categories.map(function (key) { return CATEGORY_LABELS[key]; }).join("、")
                : "不抽取实体";
              var message =
                "将分析 " + range.chapters.length + " 章（" + range.label + "），" +
                "预计输入约 " + range.inputTokens + " token、输出约 " + range.outputTokens + " token。\n" +
                "抽取类别：" + categoryText + "。\n" +
                "章节正文会发送到所配置的第三方接口，确认开始？";
              if (!window.confirm(message)) return;

              state.session += 1;
              var session = state.session;
              state.book = book;
              state.bookKey = bookKey;
              state.cancelRequested = false;
              state.controller = null;
              state.busy = "analyze";
              state.progress = {
                phase: "chapter",
                total: range.chapters.length,
                volumeTotal: 0,
                done: 0,
                success: 0,
                fail: 0,
                current: chapterTitle(range.chapters[0]),
                status: "running",
              };
              renderControls();
              renderProgress();
              ctx.toast("开始逐章分析 " + range.chapters.length + " 章");

              function alive() {
                return (
                  el.isConnected &&
                  state.session === session &&
                  !state.cancelRequested &&
                  isCurrentBook(bookKey)
                );
              }

              for (var index = 0; index < range.chapters.length; index += 1) {
                if (!alive()) break;
                var chapter = range.chapters[index];
                state.progress.current = chapterTitle(chapter);
                renderProgress();

                try {
                  var payload = await requestChapterAnalysis(config, chapter, categories, {
                    onController: function (controller) {
                      if (alive()) state.controller = controller;
                    },
                  });
                  if (!alive()) break;
                  state.results.chapters[chapter.id] = {
                    title: chapterTitle(chapter),
                    summary: payload.summary,
                    events: payload.events,
                    keyExcerpts: payload.keyExcerpts,
                    entities: payload.entities,
                    model: config.model,
                    at: new Date().toISOString(),
                  };
                  state.results.entityMeta = {
                    lastRunAt: new Date().toISOString(),
                    categories: categories.slice(),
                  };
                  state.progress.success += 1;
                  state.progress.done += 1;
                  await saveResultsQuietly();
                } catch (error) {
                  if (!alive()) break;
                  state.results.chapters[chapter.id] = failEntry(chapter, config, error);
                  state.progress.fail += 1;
                  state.progress.done += 1;
                  await saveResultsQuietly();
                }

                if (!alive()) break;
                renderResults();
                renderProgress();
              }

              if (state.session !== session) return;
              state.controller = null;
              state.busy = "";
              if (state.cancelRequested) {
                state.progress.status = "stopped";
                state.progress.current = "";
                ctx.toast("已停止，保留已完成结果");
              } else if (isCurrentBook(bookKey)) {
                state.progress.status = "done";
                state.progress.current = "";
                ctx.toast(
                  "分析完成：成功 " + state.progress.success + " 章，失败 " + state.progress.fail + " 章",
                );
              }
              state.cancelRequested = false;
              renderControls();
              renderProgress();
              renderResults();
            }

            function stopAnalysis() {
              if (state.busy !== "analyze" && state.busy !== "build") return;
              state.cancelRequested = true;
              state.progress.current = "正在停止…";
              renderProgress();
              if (state.controller) {
                try {
                  state.controller.abort();
                } catch (error) {
                  /* 忽略 */
                }
              }
              renderRange();
            }

            function cancelAnalysisForBookChange() {
              if (state.busy === "analyze" || state.busy === "build") {
                state.cancelRequested = true;
                state.session += 1;
                if (state.controller) {
                  try {
                    state.controller.abort();
                  } catch (error) {
                    /* 忽略 */
                  }
                }
              }
              state.busy = "";
              state.controller = null;
              state.cancelRequested = false;
            }

            function chapterSummaryItems(chapters) {
              var items = [];
              chapters.forEach(function (chapter) {
                var item = state.results.chapters[chapter.id];
                if (item && item.summary) {
                  items.push("【" + chapterTitle(chapter) + "】" + item.summary);
                }
              });
              return items;
            }

            async function generateVolumeSummary(volumeId) {
              if (state.busy) return;
              var config = readConfigInputs();
              if (!isConfigured(config)) {
                ctx.toast("请先配置模型");
                setConfigNotice("请先配置模型", "warn");
                return;
              }
              var book = currentBook();
              if (!book) return;
              var volume = (book.volumes || []).find(function (item) {
                return item.id === volumeId;
              });
              if (!volume) return;
              var items = chapterSummaryItems(volumeChapters(volume));
              if (!items.length) {
                ctx.toast("本卷还没有可汇总的章节摘要");
                return;
              }

              var key = bookStorageKey(book);
              state.busy = "summary";
              renderControls();
              ctx.toast("正在生成卷摘要…");
              try {
                var summary = await requestSummary(config, "本卷（" + volumeTitle(volume) + "）", items);
                if (!isCurrentBook(key)) return;
                var existing = state.results.volumeSummaries[volume.id] || {};
                state.results.volumeSummaries[volume.id] = {
                  summary: summary,
                  outline: existing.outline || null,
                  entities: existing.entities || emptyEncyclopedia(),
                  at: new Date().toISOString(),
                  error: "",
                };
                await saveResultsQuietly();
                renderResults();
                ctx.toast("卷摘要已生成");
              } catch (error) {
                ctx.toast("卷摘要失败：" + ((error && error.message) || "未知错误"));
              } finally {
                if (isCurrentBook(key)) {
                  state.busy = "";
                  renderControls();
                }
              }
            }

            async function generateBookSummary() {
              if (state.busy) return;
              var config = readConfigInputs();
              if (!isConfigured(config)) {
                ctx.toast("请先配置模型");
                setConfigNotice("请先配置模型", "warn");
                return;
              }
              var book = currentBook();
              if (!book) return;

              var items = [];
              (book.volumes || []).forEach(function (volume) {
                var item = state.results.volumeSummaries[volume.id];
                if (item && item.summary) {
                  items.push("【" + volumeTitle(volume) + "】" + item.summary);
                }
              });
              if (!items.length) {
                items = chapterSummaryItems(book.chapters || []);
              }
              if (!items.length) {
                ctx.toast("请先生成章节或卷摘要");
                return;
              }

              var key = bookStorageKey(book);
              state.busy = "summary";
              renderControls();
              ctx.toast("正在生成全书摘要…");
              try {
                var summary = await requestSummary(config, "全书《" + bookTitle(book) + "》", items);
                if (!isCurrentBook(key)) return;
                state.results.bookSummary = {
                  summary: summary,
                  at: new Date().toISOString(),
                };
                await saveResultsQuietly();
                renderResults();
                ctx.toast("全书摘要已生成");
              } catch (error) {
                ctx.toast("全书摘要失败：" + ((error && error.message) || "未知错误"));
              } finally {
                if (isCurrentBook(key)) {
                  state.busy = "";
                  renderControls();
                }
              }
            }

            async function buildEncyclopedia() {
              if (state.busy) return;
              var config = readConfigInputs();
              if (!isConfigured(config)) {
                setConfigNotice("请先配置模型", "warn");
                ctx.toast("请先配置模型");
                return;
              }
              var categories = readCategories();
              if (!categories.length) {
                ctx.toast("请至少勾选一个生成类别");
                return;
              }
              var book = currentBook();
              var bookKey = bookStorageKey(book);
              if (!book || !bookKey) {
                ctx.toast("请先导入一本书");
                return;
              }
              var groups = analyzedGroups();
              if (!groups.length) {
                ctx.toast("请先逐章分析，再生成大纲与设定集");
                renderResultsActions();
                return;
              }
              var estimate = buildEstimate(groups, categories);
              var message =
                "将生成大纲与设定集：\n" +
                "- 已完成的逐章摘要：" + estimate.chapters + " 章\n" +
                "- 卷归并：" + groups.length + " 卷，预计输入 ≈ " +
                estimate.volumeInputTokens + " token、输出 ≈ " +
                estimate.volumeOutputTokens + " token\n" +
                "- 全书汇总：1 次，预计输入 ≈ " + estimate.bookInputTokens +
                " token、输出 ≈ " + estimate.bookOutputTokens + " token\n" +
                "章节摘要、关键原文与已抽实体将发送到所配置的第三方接口，确认开始？";
              if (!window.confirm(message)) return;

              state.session += 1;
              var session = state.session;
              state.book = book;
              state.bookKey = bookKey;
              state.cancelRequested = false;
              state.controller = null;
              state.busy = "build";
              state.progress = {
                phase: "volume",
                total: groups.length + 1,
                volumeTotal: groups.length,
                done: 0,
                success: 0,
                fail: 0,
                current: volumeTitle(groups[0].volume),
                status: "running",
              };
              renderControls();
              renderProgress();
              ctx.toast("开始按卷归并，共 " + groups.length + " 卷");

              function alive() {
                return (
                  el.isConnected &&
                  state.session === session &&
                  !state.cancelRequested &&
                  isCurrentBook(bookKey)
                );
              }

              for (var index = 0; index < groups.length; index += 1) {
                if (!alive()) break;
                var group = groups[index];
                state.progress.phase = "volume";
                state.progress.current = volumeTitle(group.volume);
                renderProgress();

                try {
                  var payload = await requestVolumeMerge(
                    config,
                    group.volume,
                    group.entries,
                    categories,
                    {
                      onController: function (controller) {
                        if (alive()) state.controller = controller;
                      },
                    },
                  );
                  if (!alive()) break;
                  state.results.volumeSummaries[group.volume.id] = {
                    summary: payload.summary,
                    outline: payload.outline,
                    entities: payload.encyclopedia,
                    at: new Date().toISOString(),
                    error: "",
                  };
                  state.progress.success += 1;
                } catch (error) {
                  if (!alive()) break;
                  state.results.volumeSummaries[group.volume.id] = {
                    summary: "",
                    outline: null,
                    entities: emptyEncyclopedia(),
                    at: new Date().toISOString(),
                    error: (error && error.message) || "卷归并失败",
                  };
                  state.progress.fail += 1;
                  ctx.toast(
                    "卷《" + volumeTitle(group.volume) + "》归并失败：" +
                    ((error && error.message) || "未知错误"),
                  );
                }

                state.progress.done += 1;
                await saveResultsQuietly();
                if (!alive()) break;
                renderResults();
                renderProgress();
              }

              if (state.session !== session) return;

              if (state.progress.success > 0) {
                state.results.entityMeta = {
                  lastRunAt: new Date().toISOString(),
                  categories: categories.slice(),
                };
                await saveResultsQuietly();
              }

              if (alive() && !state.cancelRequested) {
                var volumeInputs = [];
                groups.forEach(function (group) {
                  var entry = state.results.volumeSummaries[group.volume.id];
                  if (entry && entry.summary) {
                    volumeInputs.push({ volume: group.volume, item: entry });
                  }
                });

                if (volumeInputs.length) {
                  state.progress.phase = "book";
                  state.progress.current = "全书《" + bookTitle(book) + "》";
                  renderProgress();

                  try {
                    var bookPayload = await requestBookMerge(
                      config,
                      book,
                      volumeInputs,
                      categories,
                      {
                        onController: function (controller) {
                          if (alive()) state.controller = controller;
                        },
                      },
                    );
                    if (alive()) {
                      if (bookPayload.outline) {
                        bookPayload.outline.at = new Date().toISOString();
                        bookPayload.outline.model = config.model;
                        state.results.outline = bookPayload.outline;
                      } else if (categoryEnabled(categories, "outline")) {
                        ctx.toast("全书汇总未返回大纲，保留已有大纲");
                      }
                      ENCYCLOPEDIA_KEYS.forEach(function (key) {
                        if (!categoryEnabled(categories, key)) return;
                        state.results.encyclopedia[key] = bookPayload.encyclopedia[key];
                      });
                      state.results.entityMeta = {
                        lastRunAt: new Date().toISOString(),
                        categories: categories.slice(),
                      };
                      state.progress.success += 1;
                      await saveResultsQuietly();
                    }
                  } catch (error) {
                    if (alive()) {
                      state.progress.fail += 1;
                      ctx.toast(
                        "全书汇总失败：" + ((error && error.message) || "未知错误"),
                      );
                    }
                  }
                  state.controller = null;
                } else {
                  ctx.toast("没有可汇总的卷结果，已保留卷级结果");
                }
              }

              if (state.session !== session) return;
              if (!state.cancelRequested) state.progress.done = state.progress.total;
              state.controller = null;
              state.busy = "";
              if (state.cancelRequested) {
                state.progress.status = "stopped";
                state.progress.current = "";
                ctx.toast("已停止，保留已完成的大纲与设定集结果");
              } else {
                state.progress.status = "done";
                state.progress.current = "";
                ctx.toast(
                  "生成完成：成功 " + state.progress.success + " 次，失败 " +
                  state.progress.fail + " 次",
                );
              }
              state.cancelRequested = false;
              renderControls();
              renderProgress();
              renderResults();
            }

            function clearBookResults() {
              if (state.busy) return;
              var book = currentBook();
              if (!book) return;
              if (!window.confirm("确定清空《" + bookTitle(book) + "》的全部 AI 分析结果？此操作无法撤销。")) {
                return;
              }
              var key = bookStorageKey(book);
              storage
                .remove(key)
                .then(function () {
                  if (!isCurrentBook(key)) return;
                  state.results = emptyResults();
                  state.activeTab = "chapters";
                  resetProgress();
                  renderResults();
                  renderRange();
                  ctx.toast("已清空本书 AI 结果");
                })
                .catch(function (error) {
                  ctx.toast("清空失败：" + ((error && error.message) || "未知错误"));
                });
            }

            function onPresetChange() {
              var preset = PRESETS[refs.preset.value];
              if (!preset) return;
              refs.baseUrl.value = preset.baseUrl;
              refs.model.value = preset.model;
              setConfigNotice(null);
              renderControls();
            }

            function onConfigInput() {
              state.configNotice = null;
              renderConfigStatus();
              renderRange();
            }

            function onCategoryChange() {
              saveCategories();
            }

            function onBookChanged() {
              if (!el.isConnected) return;
              cancelAnalysisForBookChange();
              refreshBook();
            }

            function onChapterChanged() {
              if (!el.isConnected) return;
              renderRange();
            }

            refs.preset.onchange = onPresetChange;
            refs.baseUrl.oninput = onConfigInput;
            refs.model.oninput = onConfigInput;
            refs.apiKey.oninput = onConfigInput;
            refs.skipExcluded.onchange = renderRange;
            refs.rangeType.onchange = function () {
              updateVolumeField();
              renderRange();
            };
            refs.volume.onchange = renderRange;
            refs.save.onclick = saveConfig;
            refs.test.onclick = testConnection;
            refs.clearKey.onclick = clearKey;
            refs.start.onclick = analyze;
            refs.build.onclick = buildEncyclopedia;
            refs.stop.onclick = stopAnalysis;
            refs.bookSummary.onclick = generateBookSummary;
            refs.exportJson.onclick = exportJson;
            refs.exportMd.onclick = exportMarkdown;
            refs.clear.onclick = clearBookResults;
            CATEGORY_ORDER.forEach(function (key) {
              if (refs.categoryInputs[key]) {
                refs.categoryInputs[key].onchange = onCategoryChange;
              }
            });

            window.addEventListener("nd:book-changed", onBookChanged);
            window.addEventListener("nd:chapter-changed", onChapterChanged);

            applyConfig(emptyConfig());
            renderConfigStatus();
            renderControls();
            renderResults();

            storage
              .get("config", emptyConfig())
              .then(function (config) {
                applyConfig(normalizeConfig(config));
                renderConfigStatus();
                renderControls();
                renderResults();
              })
              .catch(function (error) {
                setConfigNotice(
                  "插件存储不可用：" + ((error && error.message) || "未知错误"),
                  "danger",
                );
              });

            refreshBook();

            el.addEventListener("keydown", function (event) {
              if (event.key === "Enter" && event.target === refs.apiKey) {
                event.preventDefault();
                saveConfig();
              }
            });
          },
          onShow: function () {
            // 视图容器由宿主保留；书籍变化另由 nd:book-changed 处理。
          },
        },
      ],
    },
  });
})();

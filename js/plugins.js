(function () {
  "use strict";

  const RP = window.RP;
  if (!RP) return;

  const API_VERSION = 1;
  const TEMPLATE_KEY = "rp-disassembly-templates-v1";
  const PLUGIN_STATE_KEY = "rp-disassembly-plugin-state-v1";
  const MANIFEST_SCRIPT = "plugins/index.js";

  const DEFAULT_TEMPLATES = Object.freeze({
    volumeFolder: "{{volumeNo}}_{{volumeSafe}}",
    chapterFile: "{{chapterNo}}_{{titleSafe}}.txt",
    header: "{{title}}",
  });

  const SUPPORTED_HOOKS = ["normalizeEntry", "defineVariables"];

  let memoryTemplates = null;
  let memoryOverrides = null;

  const state = {
    records: [],
    byId: Object.create(null),
    overrides: {},
    loaded: false,
    loading: null,
    indexLoaded: false,
    indexError: "",
  };

  function readJSON(key, fallback) {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return fallback;
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return false;
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function readOverrides() {
    const saved = readJSON(PLUGIN_STATE_KEY, null);
    if (saved && typeof saved === "object" && !Array.isArray(saved)) return saved;
    return memoryOverrides || {};
  }

  state.overrides = readOverrides();

  function appendError(record, message) {
    const text = String(message || "");
    if (!text) return;
    if (record.error && record.error.indexOf(text) !== -1) return;
    record.error = record.error ? record.error + "；" + text : text;
  }

  function pad(value, length) {
    return RP.pad(value, length);
  }

  function baseName(fileName) {
    return String(fileName || "未命名").replace(/\.txt$/i, "").trim() || "未命名";
  }

  function localDate() {
    const now = new Date();
    return now.getFullYear() + "-" + pad(now.getMonth() + 1, 2) + "-" + pad(now.getDate(), 2);
  }

  function defaultVariables(entry, options) {
    const book = (entry && entry.book) || {};
    const volume = (entry && entry.volume) || {};
    const chapter = (entry && entry.chapter) || {};
    const index = (entry && entry.index) || {};

    const bookName = String(book.name || baseName(book.fileName) || "未命名");
    const volumeNo = volume.synthetic
      ? "00"
      : pad(
          volume.number != null
            ? volume.number
            : volume.index != null
              ? volume.index + 1
              : 1,
          2,
        );
    const volumeSafe = volume.synthetic
      ? "序章"
      : RP.safeFileName(volume.name || volume.title, "卷");
    const volumeTitle = String(volume.name || volume.title || "");
    const title = chapter.title != null ? String(chapter.title) : "";

    return {
      book: bookName,
      bookSafe: RP.safeFileName(bookName, "书"),
      volume: String(volume.title || ""),
      volumeNo: volumeNo,
      volumeSafe: volumeSafe,
      volumeTitle: volumeTitle,
      chapterNo: index.global != null ? pad(index.global, 4) : "0000",
      localNo: index.local != null ? pad(index.local, 4) : "0000",
      title: title,
      titleSafe: RP.safeFileName(title, "章节"),
      rawTitle: chapter.rawTitle != null ? String(chapter.rawTitle) : title,
      type: chapter.type || "chapter",
      date: localDate(),
      ext: "txt",
    };
  }

  function priorityOf(record) {
    return Number.isFinite(Number(record.priority)) ? Number(record.priority) : 100;
  }

  function sortedRecords() {
    return state.records.slice().sort(function (a, b) {
      return priorityOf(a) - priorityOf(b) || a.order - b.order;
    });
  }

  function activeRecords() {
    return sortedRecords().filter(function (record) {
      return record.enabled && record.compatible && record.registered && record.def;
    });
  }

  function computeEnabled(record) {
    if (Object.prototype.hasOwnProperty.call(state.overrides, record.id)) {
      return !!state.overrides[record.id];
    }
    return !!record.manifestEnabled;
  }

  function listItem(record) {
    return {
      id: record.id,
      name: record.name || record.id,
      version: record.version || "0.0.0",
      priority: priorityOf(record),
      enabled: !!record.enabled,
      error: record.error || "",
      hooks: record.hooks.slice(),
      description: record.description || "",
      compatible: !!record.compatible,
      registered: !!record.registered,
      manifest: !!record.manifest,
      apiVersion: record.apiVersion,
    };
  }

  function makeRecord(source, order) {
    const apiVersion = source.apiVersion == null ? null : Number(source.apiVersion);
    const record = {
      id: String(source.id || "").trim(),
      name: String(source.name || source.id || ""),
      version: String(source.version || "0.0.0"),
      apiVersion: apiVersion,
      priority: source.priority == null ? 100 : Number(source.priority),
      description: String(source.description || ""),
      manifestEnabled: !!source.enabled,
      manifest: !!source.manifest,
      registered: false,
      def: null,
      hooks: [],
      compatible: apiVersion === API_VERSION,
      error: "",
      order: order,
      entryPath: "",
    };
    if (apiVersion !== API_VERSION) {
      appendError(
        record,
        "apiVersion " + (apiVersion == null ? "缺失" : apiVersion) + " 与当前插件 API " + API_VERSION + " 不兼容",
      );
    }
    record.enabled = computeEnabled(record);
    return record;
  }

  function addRecord(record) {
    state.records.push(record);
    state.byId[record.id] = record;
    return record;
  }

  RP.plugins = {
    apiVersion: API_VERSION,
    DEFAULT_TEMPLATES: DEFAULT_TEMPLATES,

    register: function (def) {
      if (!def || typeof def !== "object") return null;
      const id = String(def.id || "").trim();
      if (!id) return null;

      let record = state.byId[id];
      if (!record) {
        record = makeRecord(
          {
            id: id,
            name: def.name,
            version: def.version,
            apiVersion: def.apiVersion,
            priority: def.priority == null ? 100 : def.priority,
            description: def.description,
            enabled: false,
            manifest: false,
          },
          state.records.length,
        );
        addRecord(record);
      }

      record.registered = true;
      record.def = def;
      if (def.name) record.name = String(def.name);
      if (def.version) record.version = String(def.version);
      if (def.description) record.description = String(def.description);
      if (def.priority != null && Number.isFinite(Number(def.priority))) {
        record.priority = Number(def.priority);
      }
      if (def.apiVersion != null) {
        record.apiVersion = Number(def.apiVersion);
        if (record.apiVersion !== API_VERSION) {
          record.compatible = false;
          appendError(
            record,
            "apiVersion " + def.apiVersion + " 与当前插件 API " + API_VERSION + " 不兼容",
          );
        }
      } else if (record.apiVersion == null) {
        record.compatible = false;
        appendError(record, "apiVersion 缺失，与当前插件 API " + API_VERSION + " 不兼容");
      }

      const hooks = def.hooks && typeof def.hooks === "object" ? def.hooks : {};
      record.hooks = SUPPORTED_HOOKS.filter(function (name) {
        return typeof hooks[name] === "function";
      });
      if (!record.compatible) record.hooks = [];
      record.enabled = computeEnabled(record);
      return listItem(record);
    },

    list: function () {
      return sortedRecords().map(listItem);
    },

    load: function () {
      if (state.loading) return state.loading;

      state.loading = new Promise(function (resolve) {
        if (typeof document === "undefined") {
          state.loaded = true;
          state.loading = null;
          resolve(RP.plugins.list());
          return;
        }

        Array.prototype.slice
          .call(document.querySelectorAll("script[data-rp-plugin]"))
          .forEach(function (script) {
            script.remove();
          });

        state.records = [];
        state.byId = Object.create(null);
        state.loaded = false;
        state.indexLoaded = false;
        state.indexError = "";
        window.RP_PLUGIN_INDEX = null;

        function finish() {
          state.loaded = true;
          state.loading = null;
          resolve(RP.plugins.list());
        }

        loadScript(MANIFEST_SCRIPT).then(function (error) {
          if (error) {
            state.indexError = "未找到或无法加载插件清单 " + MANIFEST_SCRIPT;
            finish();
            return;
          }

          if (!Array.isArray(window.RP_PLUGIN_INDEX)) {
            state.indexError = "插件清单格式错误：plugins/index.js 未设置 window.RP_PLUGIN_INDEX 数组";
            finish();
            return;
          }
          state.indexLoaded = true;
          registerManifest(window.RP_PLUGIN_INDEX);

          const queue = state.records.slice().sort(function (a, b) {
            return priorityOf(a) - priorityOf(b) || a.order - b.order;
          });

          queue
            .reduce(function (chain, record) {
              return chain.then(function () {
                if (!record.entryPath) return null;
                return loadScript("plugins/" + record.entryPath).then(function (loadError) {
                  if (loadError) {
                    appendError(record, "脚本加载失败：" + record.entryPath);
                    return;
                  }
                  if (!record.registered) {
                    appendError(record, "脚本未调用 RP.plugins.register 注册插件 " + record.id);
                  }
                });
              });
            }, Promise.resolve())
            .then(finish, finish);
        }).catch(function (error) {
          state.indexError = state.indexError || "插件加载失败：" +
            (error && error.message ? error.message : String(error));
          finish();
        });
      });

      return state.loading;
    },

    normalize: function (entry, ctx) {
      if (!entry || typeof entry !== "object") return entry;
      const context = ctx && typeof ctx === "object" ? ctx : {};
      if (!context.book && entry.book) context.book = entry.book;
      if (!context.options) context.options = {};

      const records = activeRecords();
      for (const record of records) {
        const hook = record.def.hooks && record.def.hooks.normalizeEntry;
        if (typeof hook !== "function") continue;
        context.variables = defaultVariables(entry, context.options);
        try {
          const result = hook(entry, context);
          if (result && typeof result === "object") entry = result;
        } catch (error) {
          appendError(record, "normalizeEntry：" + (error && error.message ? error.message : String(error)));
        }
      }

      context.variables = defaultVariables(entry, context.options);
      return entry;
    },

    variables: function (entry, ctx) {
      const context = ctx && typeof ctx === "object" ? ctx : {};
      if (!context.options) context.options = {};
      const vars = defaultVariables(entry, context.options);

      for (const record of activeRecords()) {
        const hook = record.def.hooks && record.def.hooks.defineVariables;
        if (typeof hook !== "function") continue;
        context.variables = vars;
        try {
          const result = hook(entry, context);
          if (!result || typeof result !== "object") continue;
          Object.keys(result).forEach(function (name) {
            if (!name) return;
            const key = String(name);
            const value = result[name];
            vars["plugin." + record.id + "." + key] = value;
            if (!Object.prototype.hasOwnProperty.call(vars, key)) vars[key] = value;
          });
        } catch (error) {
          appendError(record, "defineVariables：" + (error && error.message ? error.message : String(error)));
        }
      }

      context.variables = vars;
      return vars;
    },

    render: function (template, vars) {
      if (template == null) return "";
      const source = String(template);
      const values = vars && typeof vars === "object" ? vars : {};
      return source.replace(/\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}/g, function (all, name) {
        if (!Object.prototype.hasOwnProperty.call(values, name)) return "";
        const value = values[name];
        return value == null ? "" : String(value);
      });
    },

    templates: function () {
      let saved = readJSON(TEMPLATE_KEY, null);
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
        saved = memoryTemplates || {};
      }
      const result = {};
      Object.keys(DEFAULT_TEMPLATES).forEach(function (key) {
        result[key] = typeof saved[key] === "string" ? saved[key] : DEFAULT_TEMPLATES[key];
      });
      return result;
    },

    setTemplates: function (patch) {
      const current = RP.plugins.templates();
      const source = patch && typeof patch === "object" ? patch : {};
      const next = {};
      Object.keys(DEFAULT_TEMPLATES).forEach(function (key) {
        next[key] = typeof source[key] === "string" ? source[key] : current[key];
      });
      memoryTemplates = next;
      writeJSON(TEMPLATE_KEY, next);
      return next;
    },

    defaultTemplates: function () {
      return {
        volumeFolder: DEFAULT_TEMPLATES.volumeFolder,
        chapterFile: DEFAULT_TEMPLATES.chapterFile,
        header: DEFAULT_TEMPLATES.header,
      };
    },

    isEnabled: function (id) {
      const record = state.byId[String(id || "")];
      return !!(record && record.enabled);
    },

    setEnabled: function (id, value) {
      const key = String(id || "");
      const record = state.byId[key];
      if (!record) return false;
      state.overrides[key] = !!value;
      memoryOverrides = state.overrides;
      writeJSON(PLUGIN_STATE_KEY, state.overrides);
      record.enabled = !!value;
      return true;
    },

    safePath: function (value, fallback) {
      const segments = String(value == null ? "" : value).split(/[\\/]+/);
      const parts = [];
      segments.forEach(function (segment) {
        const safe = sanitizeSegment(segment);
        if (safe && safe !== "." && safe !== "..") parts.push(safe);
      });
      if (parts.length) return parts.join("/");

      const fallbackParts = [];
      String(fallback == null ? "" : fallback)
        .split(/[\\/]+/)
        .forEach(function (segment) {
          const safe = sanitizeSegment(segment);
          if (safe && safe !== "." && safe !== "..") fallbackParts.push(safe);
        });
      return fallbackParts.length ? fallbackParts.join("/") : "未命名";
    },

    status: function () {
      const list = RP.plugins.list();
      return {
        loaded: !!state.loaded,
        loading: !!state.loading,
        indexLoaded: !!state.indexLoaded,
        indexError: state.indexError || "",
        manifestPath: MANIFEST_SCRIPT,
        count: list.length,
        errorCount: list.filter(function (item) { return !!item.error; }).length,
      };
    },
  };

  function sanitizeSegment(value) {
    let text = String(value == null ? "" : value)
      .replace(/[\\:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .replace(/^[.\s]+|[.\s]+$/g, "");
    if (!text || text === "." || text === "..") return "";
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(text)) text = "_" + text;
    return text;
  }

  function normalizeEntryPath(value) {
    const path = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!path || path.charAt(0) === "/" || /^[A-Za-z]:/.test(path)) return "";
    if (path.split("/").indexOf("..") !== -1) return "";
    return path;
  }

  function registerManifest(index) {
    index.forEach(function (item, indexPosition) {
      if (!item || typeof item !== "object") return;
      const id = String(item.id || "").trim();
      if (!id) {
        const record = makeRecord(
          {
            id: "清单条目 " + (indexPosition + 1),
            name: "清单条目 " + (indexPosition + 1),
            version: "0.0.0",
            apiVersion: item.apiVersion,
            priority: item.priority,
            description: item.description,
            enabled: false,
            manifest: true,
          },
          state.records.length,
        );
        appendError(record, "清单条目缺少 id");
        addRecord(record);
        return;
      }
      if (state.byId[id]) {
        appendError(state.byId[id], "清单中存在重复 id：" + id);
        return;
      }
      const entryPath = normalizeEntryPath(item.entry);
      const record = makeRecord(
        {
          id: id,
          name: item.name,
          version: item.version,
          apiVersion: item.apiVersion,
          priority: item.priority,
          description: item.description,
          enabled: item.enabled,
          manifest: true,
        },
        state.records.length,
      );
      record.entryPath = entryPath;
      if (!entryPath) appendError(record, "清单缺少合法的 entry 路径");
      addRecord(record);
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve) {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.setAttribute("data-rp-plugin", "1");
      script.onload = function () {
        resolve(null);
      };
      script.onerror = function () {
        resolve(new Error("无法加载 " + src));
      };
      document.head.appendChild(script);
    });
  }
})();

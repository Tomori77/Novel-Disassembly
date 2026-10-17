(function () {
  "use strict";

  if (!window.ND || !window.ND.plugins) return;

  var MAX_CHAPTERS = 50;
  var MAX_BODY_CHARS = 8000;
  var MAX_SUMMARY_INPUT = 12000;
  var MAX_TOKENS = 800;
  var TIMEOUT_MS = 90000;

  var PRESETS = {
    openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    glm: { label: "GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
    ollama: { label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
    custom: { label: "自定义", baseUrl: "", model: "" },
  };
  var PRESET_ORDER = ["openai", "deepseek", "glm", "ollama", "custom"];
  var TYPE_LABELS = { character: "人物", event: "事件", foreshadow: "伏笔" };
  var ENTITY_TYPES = ["character", "event", "foreshadow"];

  function emptyConfig() {
    return { preset: "", baseUrl: "", model: "", apiKey: "", skipExcluded: true };
  }

  function emptyResults() {
    return { chapters: {}, volumeSummaries: {}, bookSummary: null, updatedAt: "" };
  }

  function normalizeConfig(value) {
    var source = value && typeof value === "object" ? value : {};
    return {
      preset: typeof source.preset === "string" ? source.preset : "",
      baseUrl: typeof source.baseUrl === "string" ? source.baseUrl : "",
      model: typeof source.model === "string" ? source.model : "",
      apiKey: typeof source.apiKey === "string" ? source.apiKey : "",
      skipExcluded: source.skipExcluded !== false,
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
          at: toText(item.at),
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
    if (typeof source.updatedAt === "string") result.updatedAt = source.updatedAt;
    return result;
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

  function buildSkeleton(el) {
    var options = PRESET_ORDER.map(function (key) {
      return '<option value="' + key + '">' + PRESETS[key].label + "</option>";
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
              '<p class="hint">顺序调用，单次最多 50 章。只发送选中章节的标题与正文。</p></div>' +
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
              '<button class="primary" data-role="start">开始分析</button>' +
              '<button class="danger" data-role="stop" disabled>停止</button>' +
            "</div>" +
            '<p class="ai-status" data-role="rangeStatus"></p>' +
          "</section>" +
        "</div>" +
        '<div class="ai-column">' +
          '<section class="ai-block ai-results">' +
            '<div class="ai-block-head ai-result-head">' +
              "<div><h3>分析结果</h3>" +
                '<p class="hint" data-role="resultMeta">尚未分析。</p></div>' +
              '<div class="actions">' +
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
            '<div data-role="bookSummaryBox"></div>' +
            '<div class="ai-volume-list" data-role="volumeList"></div>' +
            '<div class="ai-result-list" data-role="chapterList"></div>' +
          "</section>" +
        "</div>" +
      "</div>";
  }

  function chapterPrompt(chapter) {
    var body = truncate(chapter.body || "", MAX_BODY_CHARS);
    return [
      { role: "system", content: "你是小说拆解助手。严格只输出 JSON，不要 Markdown 代码块。" },
      {
        role: "user",
        content:
          "章节标题：" + chapterTitle(chapter) + "\n" +
          "正文（最多 8000 字）：\n" + body + "\n" +
          "请输出：\n" +
          '{"summary":"不超过150字","events":["关键事件"],' +
          '"entities":[{"type":"character|event|foreshadow","name":"","aliases":[],"note":"不超过40字"}]}',
      },
    ];
  }

  function summaryPrompt(scopeTitle, items) {
    var text = truncate(items.join("\n\n"), MAX_SUMMARY_INPUT);
    return [
      { role: "system", content: "你是小说拆解助手。严格只输出 JSON，不要 Markdown 代码块。" },
      {
        role: "user",
        content:
          "以下是" + scopeTitle + "的已有摘要。请汇总为 200 字以内的整体摘要，" +
          '只输出 {"summary":"..."}。\n\n' + text,
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

  function normalizeEntity(item) {
    if (!item || typeof item !== "object") return null;
    var type = toText(item.type || item.entityType).trim().toLowerCase();
    if (type === "人物" || type === "角色") type = "character";
    if (type === "事件") type = "event";
    if (type === "伏笔" || type === "伏线") type = "foreshadow";
    if (ENTITY_TYPES.indexOf(type) < 0) return null;
    var name = toText(item.name).trim();
    if (!name) return null;
    var aliases = [];
    if (Array.isArray(item.aliases)) {
      item.aliases.forEach(function (alias) {
        var value = toText(alias).trim();
        if (value && aliases.indexOf(value) < 0) aliases.push(value);
      });
    }
    return { type: type, name: name, aliases: aliases, note: toText(item.note).trim() };
  }

  function normalizeChapterPayload(data) {
    var summary = toText(data.summary).trim();
    var events = [];
    if (Array.isArray(data.events)) {
      data.events.forEach(function (event) {
        var value = toText(event).trim();
        if (value && events.indexOf(value) < 0) events.push(value);
      });
    }
    var entities = [];
    if (Array.isArray(data.entities)) {
      data.entities.forEach(function (item) {
        var entity = normalizeEntity(item);
        if (entity) entities.push(entity);
      });
    }
    if (!summary && !events.length && !entities.length) {
      throw new Error("模型返回内容为空");
    }
    return { summary: summary, events: events, entities: entities };
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
    var info = {};
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
            max_tokens: settings.maxTokens || MAX_TOKENS,
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

  function requestSummary(config, scopeTitle, items) {
    return requestChat(config, summaryPrompt(scopeTitle, items), { maxTokens: MAX_TOKENS }).then(
      function (content) {
        var data = parseJsonContent(content);
        var summary = toText(data.summary).trim();
        if (!summary) throw new Error("模型未返回摘要");
        return summary;
      },
    );
  }

  ND.plugins.register({
    id: "ai-analysis",
    name: "AI 分析",
    version: "0.1.0",
    apiVersion: 1,
    priority: 50,
    description:
      "通过 OpenAI 兼容接口手动生成章节/卷/全书摘要，抽取人物、事件与伏笔，结果按书保存在本地插件存储。",
    ui: {
      views: [
        {
          id: "ai",
          label: "AI 分析",
          mount: function (el, ctx) {
            buildSkeleton(el);

            var refs = {};
            Array.prototype.slice.call(el.querySelectorAll("[data-role]")).forEach(function (node) {
              refs[node.dataset.role] = node;
            });

            var storage = ctx.storage;
            var state = {
              book: ctx.getBook(),
              bookKey: "",
              results: emptyResults(),
              progress: { total: 0, done: 0, success: 0, fail: 0, current: "", status: "idle" },
              busy: "",
              cancelRequested: false,
              controller: null,
              session: 0,
              configNotice: null,
              storageWarned: false,
            };

            function currentBook() {
              return ctx.getBook();
            }

            function isCurrentBook(key) {
              var book = currentBook();
              return !!book && bookStorageKey(book) === key;
            }

            function readConfigInputs() {
              return {
                preset: refs.preset.value,
                baseUrl: refs.baseUrl.value.trim(),
                model: refs.model.value.trim(),
                apiKey: refs.apiKey.value,
                skipExcluded: refs.skipExcluded.checked,
              };
            }

            function applyConfig(config) {
              refs.preset.value = PRESETS[config.preset] ? config.preset : "";
              refs.baseUrl.value = config.baseUrl || "";
              refs.model.value = config.model || "";
              refs.apiKey.value = config.apiKey || "";
              refs.skipExcluded.checked = config.skipExcluded !== false;
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
                total: 0,
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
                message = "正在分析：" + (state.progress.current || "准备中");
              } else {
                message = "范围：" + range.label + " · " + total + " 章，可开始分析";
              }
              if (state.progress.status === "stopped" && !state.busy) {
                message = "已停止，保留已完成的结果";
                kind = "warn";
              }
              setStatus(refs.rangeStatus, message, kind);

              var blocked = !!range.error || !total || !isConfigured(config);
              refs.start.disabled = !!state.busy || blocked;
              refs.stop.disabled = state.busy !== "analyze";
              refs.rangeType.disabled = state.busy === "analyze";
              refs.volume.disabled = state.busy === "analyze";
            }

            function renderControls() {
              var analyzing = state.busy === "analyze";
              refs.preset.disabled = analyzing;
              refs.baseUrl.disabled = analyzing;
              refs.model.disabled = analyzing;
              refs.apiKey.disabled = analyzing;
              refs.skipExcluded.disabled = analyzing;
              refs.save.disabled = analyzing;
              refs.test.disabled = !!state.busy;
              refs.clearKey.disabled = analyzing;
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

              var label = "分析中";
              if (progress.status === "done") label = "分析完成";
              if (progress.status === "stopped") label = "已停止";
              refs.progressStatus.textContent = label;
              refs.progressCount.textContent = progress.done + " / " + progress.total;
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

            function hasAnySummary() {
              var book = currentBook();
              if (!book) return false;
              return (book.chapters || []).some(function (chapter) {
                var item = state.results.chapters[chapter.id];
                return !!(item && item.summary);
              });
            }

            function hasVolumeSummary() {
              return Object.keys(state.results.volumeSummaries || {}).some(function (key) {
                var item = state.results.volumeSummaries[key];
                return !!(item && item.summary);
              });
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
              refs.clear.disabled = !book || !count || !!state.busy;
              refs.bookSummary.disabled =
                !book || !!state.busy || (!hasVolumeSummary() && !hasAnySummary());
              Array.prototype.slice.call(el.querySelectorAll("[data-volume-summary]")).forEach(
                function (button) {
                  button.disabled = !!state.busy || button.dataset.count === "0";
                },
              );
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
              if (item.entities && item.entities.length) {
                var tags = makeElement("div", "ai-entities");
                item.entities.forEach(function (entity) {
                  appendEntity(tags, entity);
                });
                card.appendChild(tags);
              }
              if (!item.summary && !item.error && !(item.events && item.events.length) &&
                  !(item.entities && item.entities.length)) {
                card.appendChild(makeElement("p", "ai-empty", "该章没有可用结果"));
              }
              return card;
            }

            function renderChapters() {
              clearNode(refs.chapterList);
              var book = currentBook();
              if (!book) {
                refs.chapterList.appendChild(makeElement("div", "empty", "导入一本书后开始分析。"));
                return;
              }
              var shown = 0;
              (book.chapters || []).forEach(function (chapter) {
                var item = state.results.chapters[chapter.id];
                if (!item) return;
                shown += 1;
                refs.chapterList.appendChild(renderChapterResult(chapter, item));
              });
              if (!shown) {
                refs.chapterList.appendChild(
                  makeElement("div", "empty", "尚无章节分析结果。选择范围后点击“开始分析”。"),
                );
              }
            }

            function renderBookSummary() {
              clearNode(refs.bookSummaryBox);
              var item = state.results.bookSummary;
              if (!item || !item.summary) {
                refs.bookSummaryBox.appendChild(
                  makeElement("p", "ai-empty", "尚未生成全书摘要。"),
                );
                return;
              }
              var box = makeElement("div", "ai-book-summary");
              var head = makeElement("div", "ai-book-summary-head");
              head.appendChild(makeElement("h4", "", "全书摘要"));
              head.appendChild(makeElement("span", "ai-result-time", formatTime(item.at)));
              box.appendChild(head);
              box.appendChild(makeElement("p", "ai-summary", item.summary));
              refs.bookSummaryBox.appendChild(box);
            }

            function renderVolumes() {
              clearNode(refs.volumeList);
              var book = currentBook();
              if (!book) return;
              var any = false;
              (book.volumes || []).forEach(function (volume) {
                var chapters = volumeChapters(volume);
                var analyzed = chapters.filter(function (chapter) {
                  var item = state.results.chapters[chapter.id];
                  return !!(item && item.summary);
                }).length;
                var summary = state.results.volumeSummaries[volume.id];
                if (!analyzed && !(summary && summary.summary)) return;
                any = true;

                var row = makeElement("article", "ai-volume-row");
                var head = makeElement("div", "ai-volume-head");
                var info = makeElement("div", "ai-volume-info");
                info.appendChild(makeElement("strong", "", volumeTitle(volume)));
                info.appendChild(
                  makeElement("span", "hint", "已分析 " + analyzed + " 章 / 共 " + chapters.length + " 章"),
                );
                head.appendChild(info);
                var button = makeElement("button", "", "生成卷摘要");
                button.setAttribute("data-volume-summary", volume.id);
                button.setAttribute("data-count", String(analyzed));
                button.disabled = !!state.busy || analyzed === 0;
                button.onclick = function () {
                  generateVolumeSummary(volume.id);
                };
                head.appendChild(button);
                row.appendChild(head);

                if (summary && summary.summary) {
                  row.appendChild(makeElement("p", "ai-summary", summary.summary));
                  row.appendChild(makeElement("span", "ai-result-time", formatTime(summary.at)));
                } else {
                  row.appendChild(makeElement("p", "ai-empty", "尚未生成卷摘要。"));
                }
                refs.volumeList.appendChild(row);
              });
              if (!any) {
                refs.volumeList.appendChild(
                  makeElement("p", "ai-empty", "卷摘要会在至少一章分析完成后出现在这里。"),
                );
              }
            }

            function renderResults() {
              renderBookSummary();
              renderVolumes();
              renderChapters();
              renderResultsActions();
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
              state.progress = { total: 0, done: 0, success: 0, fail: 0, current: "", status: "idle" };
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
              var message =
                "将分析 " + range.chapters.length + " 章（" + range.label + "），" +
                "预计输入约 " + range.inputTokens + " token、输出约 " + range.outputTokens + " token。\n" +
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
                total: range.chapters.length,
                done: 0,
                success: 0,
                fail: 0,
                current: chapterTitle(range.chapters[0]),
                status: "running",
              };
              renderControls();
              renderProgress();
              ctx.toast("开始分析 " + range.chapters.length + " 章");

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
                  var content = await requestChat(config, chapterPrompt(chapter), {
                    maxTokens: MAX_TOKENS,
                    onController: function (controller) {
                      if (alive()) state.controller = controller;
                    },
                  });
                  if (!alive()) break;
                  var payload = normalizeChapterPayload(parseJsonContent(content));
                  state.results.chapters[chapter.id] = {
                    title: chapterTitle(chapter),
                    summary: payload.summary,
                    events: payload.events,
                    entities: payload.entities,
                    model: config.model,
                    at: new Date().toISOString(),
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
              if (state.busy !== "analyze") return;
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
              if (state.busy === "analyze") {
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
                state.results.volumeSummaries[volume.id] = {
                  summary: summary,
                  at: new Date().toISOString(),
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
            refs.stop.onclick = stopAnalysis;
            refs.bookSummary.onclick = generateBookSummary;
            refs.clear.onclick = clearBookResults;

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

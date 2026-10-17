(function () {
  "use strict";

  const RP = window.RP;
  if (!RP) return;

  const HANDLE_KEY = "exportRootHandle";
  const HEALTH_TIMEOUT = 1500;
  const UNSUPPORTED_TEXT = "当前环境不支持写入目录，请用 start.bat 启动或导出 ZIP";

  const state = {
    initialized: false,
    initPromise: null,
    mode: "",
    root: "",
    exportRoot: "",
    handle: null,
    permission: "unknown",
    result: null,
  };

  function snapshot() {
    state.result = {
      mode: state.mode || "unsupported",
      root: state.root || "",
      exportRoot: state.exportRoot || "",
    };
    return state.result;
  }

  function friendlyError(prefix, error) {
    const name = error && error.name ? String(error.name) : "";
    const detail = error && error.message ? String(error.message) : "";
    let text = "";
    if (name === "AbortError") text = "已取消选择目录";
    else if (name === "NotAllowedError") text = "浏览器未授权写入该目录，请重新选择并允许写入";
    else if (name === "SecurityError") text = "浏览器禁止写入该目录，请用 start.bat 启动或导出 ZIP";
    else if (name === "NotFoundError") text = "目标目录不存在，请重新选择项目根目录";
    else if (name === "InvalidStateError") text = "目标目录状态已失效，请重新选择项目根目录";
    else if (name === "NoModificationAllowedError") text = "目标目录为只读，请选择可写目录";
    else if (name === "QuotaExceededError") text = "磁盘空间不足，无法写入导出文件";
    else if (name === "TypeError" && /showDirectoryPicker|directory picker/i.test(detail)) {
      text = "当前环境无法打开目录选择器，请用 start.bat 启动或导出 ZIP";
    } else text = detail || "未知错误";
    return new Error(prefix ? prefix + "：" + text : text);
  }

  function isPermissionError(error) {
    const name = error && error.name ? String(error.name) : "";
    return name === "NotAllowedError" || name === "SecurityError";
  }

  function probeServer() {
    if (typeof fetch !== "function") return Promise.resolve(null);
    let controller = null;
    try {
      if (typeof AbortController === "function") controller = new AbortController();
    } catch (error) {
      controller = null;
    }

    let timer = 0;
    const timeout = new Promise(function (resolve) {
      timer = setTimeout(function () {
        if (controller) {
          try {
            controller.abort();
          } catch (error) {
            /* 忽略中止异常 */
          }
        }
        resolve(null);
      }, HEALTH_TIMEOUT);
    });

    const request = Promise.resolve()
      .then(function () {
        return fetch("/api/health", {
          cache: "no-store",
          signal: controller ? controller.signal : undefined,
        });
      })
      .then(function (response) {
        if (!response || !response.ok) return null;
        return response.json();
      })
      .then(function (data) {
        if (!data || data.ok !== true) return null;
        return {
          root: typeof data.root === "string" ? data.root : "",
          exportRoot: typeof data.exportRoot === "string" ? data.exportRoot : "",
        };
      })
      .catch(function () {
        return null;
      });

    return Promise.race([request, timeout]).then(function (value) {
      clearTimeout(timer);
      return value;
    }, function () {
      clearTimeout(timer);
      return null;
    });
  }

  async function loadPickerHandle() {
    if (!RP.db || typeof RP.db.getSetting !== "function") return;
    try {
      const handle = await RP.db.getSetting(HANDLE_KEY, null);
      if (!handle || typeof handle.getDirectoryHandle !== "function") return;
      state.handle = handle;
      state.root = handle.name || "";
      state.exportRoot = state.root ? state.root + "/export" : "";
      try {
        state.permission = await handle.queryPermission({ mode: "readwrite" });
      } catch (error) {
        state.permission = "prompt";
      }
    } catch (error) {
      state.handle = null;
      state.permission = "prompt";
    }
  }

  async function detect() {
    const health = await probeServer();
    if (health) {
      state.mode = "server";
      state.root = health.root;
      state.exportRoot = health.exportRoot;
      state.initialized = true;
      return snapshot();
    }

    if (typeof window.showDirectoryPicker === "function") {
      state.mode = "picker";
      await loadPickerHandle();
    } else {
      state.mode = "unsupported";
    }

    state.initialized = true;
    return snapshot();
  }

  function init() {
    if (state.initPromise) return state.initPromise;
    state.initPromise = detect().catch(function () {
      state.mode = "unsupported";
      state.initialized = true;
      return snapshot();
    });
    return state.initPromise;
  }

  function mode() {
    return state.mode || "";
  }

  function info() {
    if (state.mode === "server") {
      const root = state.exportRoot || (state.root ? state.root.replace(/[\\/]+$/, "") + "/export" : "");
      return "服务模式：" + (root ? root.replace(/\\/g, "/") + "/<书名>/" : "export/<书名>/");
    }
    if (state.mode === "picker") {
      return "首次使用请选择项目根目录（包含 index.html），之后默认写入 export/<书名>/";
    }
    return UNSUPPORTED_TEXT;
  }

  const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
  const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

  function validateSegment(segment, label) {
    if (typeof segment !== "string" || segment === "") {
      throw new Error(label + "不能为空");
    }
    if (segment === "." || segment === "..") {
      throw new Error(label + "不能是 . 或 ..");
    }
    if (CONTROL_CHARS.test(segment)) {
      throw new Error(label + "包含控制字符");
    }
    if (/[\\/:*?"<>|]/.test(segment)) {
      throw new Error(label + "包含非法字符");
    }
    if (/^[.\s]+|[.\s]+$/.test(segment)) {
      throw new Error(label + "不能以点或空白开头或结尾");
    }
    if (WINDOWS_RESERVED.test(segment)) {
      throw new Error(label + "使用了 Windows 保留名");
    }
    return segment;
  }

  function validateBookName(value) {
    if (typeof value !== "string" || !value) throw new Error("书名目录不能为空");
    if (/[\\/]/.test(value) || /^[A-Za-z]:/.test(value) || value.charAt(0) === "/") {
      throw new Error("书名目录不能包含路径或盘符");
    }
    return validateSegment(value, "书名目录");
  }

  function validateRelativePath(value, label) {
    if (typeof value !== "string" || !value) throw new Error((label || "文件路径") + "不能为空");
    if (value.charAt(0) === "/" || value.charAt(0) === "\\") {
      throw new Error((label || "文件路径") + "不能是绝对路径");
    }
    if (/^[A-Za-z]:/.test(value)) {
      throw new Error((label || "文件路径") + "不能包含盘符");
    }
    if (CONTROL_CHARS.test(value)) {
      throw new Error((label || "文件路径") + "包含控制字符");
    }
    if (value.indexOf("\\") !== -1) {
      throw new Error((label || "文件路径") + "只能使用 / 作为分隔符");
    }
    const parts = value.split("/");
    if (!parts.length) throw new Error((label || "文件路径") + "不能为空");
    parts.forEach(function (part) {
      validateSegment(part, (label || "文件路径") + "的每一段");
    });
    return parts;
  }

  function validatePlan(plan) {
    if (!plan || typeof plan !== "object") throw new Error("导出计划为空");
    const book = validateBookName(plan.fileName);
    const files = Array.isArray(plan.files) ? plan.files : [];
    const seen = Object.create(null);
    const normalized = files.map(function (file) {
      if (!file || typeof file !== "object") throw new Error("导出文件项无效");
      const parts = validateRelativePath(file.path, "导出文件路径");
      const path = parts.join("/");
      if (seen[path]) throw new Error("导出文件路径重复：" + path);
      seen[path] = true;
      return {
        path: path,
        content: file.content == null ? "" : String(file.content),
      };
    });

    let epub = null;
    if (plan.epub && plan.epub.blob) {
      epub = {
        fileName: validateSegment(plan.epub.fileName, "EPUB 文件名"),
        blob: plan.epub.blob,
      };
    }

    return { book: book, files: normalized, epub: epub };
  }

  async function ensureDirectory(root, parts) {
    let directory = root;
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part, { create: true });
    }
    return directory;
  }

  async function writeFile(root, path, data) {
    const parts = validateRelativePath(path, "导出文件路径");
    const name = parts.pop();
    const directory = await ensureDirectory(root, parts);
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(data);
    } finally {
      await writable.close();
    }
  }

  async function saveWithPicker(plan) {
    if (typeof window.showDirectoryPicker !== "function") {
      throw new Error(UNSUPPORTED_TEXT);
    }

    let handle = state.handle;
    if (!handle || state.permission !== "granted") {
      const options = { mode: "readwrite", id: "rp-export-root" };
      if (handle) options.startIn = handle;
      try {
        handle = await window.showDirectoryPicker(options);
      } catch (error) {
        throw friendlyError("选择项目根目录失败", error);
      }
      state.handle = handle;
      state.root = handle.name || "";
      state.exportRoot = state.root ? state.root + "/export" : "";
      state.permission = "granted";
      snapshot();
      if (RP.db && typeof RP.db.setSetting === "function") {
        try {
          await RP.db.setSetting(HANDLE_KEY, handle);
        } catch (error) {
          /* 持久化失败不阻断本次导出，下次需要重新选择目录 */
        }
      }
    }

    try {
      const exportRoot = await handle.getDirectoryHandle("export", { create: true });
      const bookRoot = await exportRoot.getDirectoryHandle(plan.book, { create: true });
      for (const file of plan.files) {
        await writeFile(bookRoot, file.path, file.content);
      }
      let count = plan.files.length;
      if (plan.epub && plan.epub.blob) {
        await writeFile(bookRoot, plan.epub.fileName, plan.epub.blob);
        count += 1;
      }
      return {
        mode: "picker",
        path: (state.root ? state.root + "/" : "") + "export/" + plan.book,
        count: count,
      };
    } catch (error) {
      if (isPermissionError(error)) {
        state.permission = "prompt";
        state.handle = null;
        throw friendlyError("写入目录失败，请重新点击保存并授权", error);
      }
      throw friendlyError("写入目录失败", error);
    }
  }

  function bytesToBase64(bytes) {
    const chunk = 0x8000;
    let binary = "";
    for (let index = 0; index < bytes.length; index += chunk) {
      const slice = bytes.subarray(index, Math.min(index + chunk, bytes.length));
      binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
  }

  async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    return bytesToBase64(new Uint8Array(buffer));
  }

  async function saveWithServer(plan) {
    const binary = [];
    if (plan.epub && plan.epub.blob) {
      binary.push({
        path: plan.epub.fileName,
        base64: await blobToBase64(plan.epub.blob),
      });
    }

    const body = JSON.stringify({
      book: plan.book,
      files: plan.files,
      binary: binary,
    });

    let response;
    try {
      response = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: body,
      });
    } catch (error) {
      throw new Error("无法连接本地服务，请用 start.bat 启动后重试，或导出 ZIP");
    }

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }

    if (!response.ok || !data || data.ok !== true) {
      const detail = data && data.error ? String(data.error) : "本地服务返回 HTTP " + response.status;
      throw new Error("写入失败：" + detail);
    }

    return {
      mode: "server",
      path: data.path ? String(data.path) : (state.exportRoot ? state.exportRoot.replace(/\\/g, "/") + "/" + plan.book : "export/" + plan.book),
      count: Number(data.count) || plan.files.length + (plan.epub ? 1 : 0),
    };
  }

  async function save(plan) {
    if (!state.initialized) {
      throw new Error("导出目标尚未就绪，请稍后重试");
    }
    const validated = validatePlan(plan);

    if (state.mode === "server") return saveWithServer(validated);
    if (state.mode === "picker") return saveWithPicker(validated);
    throw new Error(UNSUPPORTED_TEXT);
  }

  RP.exportTarget = {
    init: init,
    mode: mode,
    info: info,
    save: save,
  };
})();

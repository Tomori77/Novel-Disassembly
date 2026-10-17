(function () {
  "use strict";

  const ND = window.ND;
  if (!ND) return;

  const DB_NAME = "novel-disassembly";
  const LEGACY_DB_NAME = "rp-disassembly";
  const DB_VERSION = 1;
  const STORES = ["books", "sources", "volumes", "chapters", "settings"];
  const SOURCE_TYPES = { txt: true, zip: true, folder: true };
  const OPEN_TIMEOUT = 3000;

  const ERROR_HINTS = {
    QuotaExceededError: "浏览器存储空间不足",
    ConstraintError: "数据键冲突",
    VersionError: "本地数据库版本不兼容",
    InvalidStateError: "数据库连接已失效，请刷新页面",
    AbortError: "数据库操作被中止",
    UnknownError: "浏览器拒绝了数据库操作",
    SecurityError: "浏览器安全策略禁止访问本地数据库",
    NotAllowedError: "浏览器未授权访问本地数据库",
    DataCloneError: "数据无法写入本地数据库",
  };

  let openPromise = null;
  let legacyMode = false;

  function errorText(error) {
    if (!error) return "";
    if (error.name && ERROR_HINTS[error.name]) return ERROR_HINTS[error.name];
    if (error.message) return String(error.message);
    if (error.name) return String(error.name);
    return String(error);
  }

  function makeError(prefix, error) {
    const detail = errorText(error);
    return new Error(prefix + (detail ? "：" + detail : ""));
  }

  function requireSupport() {
    if (typeof window === "undefined" || !window.indexedDB) {
      throw new Error("当前环境不支持 IndexedDB，无法持久化数据");
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function baseName(fileName) {
    return String(fileName || "").replace(/\.txt$/i, "").trim() || "未命名";
  }

  function normalizeSource(value) {
    const source = String(value || "").toLowerCase();
    return SOURCE_TYPES[source] ? source : "txt";
  }

  function pad(value, length) {
    return String(value == null ? "" : value).padStart(length, "0");
  }

  function computeStats(rawText, chapters, volumes) {
    let chapterCount = 0;
    let notices = 0;
    let notes = 0;
    let excluded = 0;
    (chapters || []).forEach(function (chapter) {
      if (!chapter) return;
      if (chapter.type === "chapter" || chapter.type === "preface") chapterCount += 1;
      if (chapter.type === "notice") notices += 1;
      if (chapter.type === "volumeNote") notes += 1;
      if (chapter.excluded) excluded += 1;
    });
    const volumeCount = (volumes || []).filter(function (volume) {
      return volume && !volume.synthetic;
    }).length;
    return {
      chars: String(rawText == null ? "" : rawText).length,
      volumes: volumeCount,
      chapters: chapterCount,
      notices: notices,
      notes: notes,
      excluded: excluded,
    };
  }

  function normalizeStats(stats, rawText, chapters, volumes) {
    const source = stats && typeof stats === "object" ? stats : {};
    const computed = computeStats(rawText, chapters, volumes);
    function pick(key) {
      const value = Number(source[key]);
      return Number.isFinite(value) ? value : computed[key];
    }
    return {
      chars: pick("chars"),
      volumes: pick("volumes"),
      chapters: pick("chapters"),
      notices: pick("notices"),
      notes: pick("notes"),
      excluded: computed.excluded,
    };
  }

  function buildBookRecord(book) {
    const stamp = nowIso();
    if (!book.createdAt) book.createdAt = stamp;
    book.updatedAt = stamp;
    return {
      id: String(book.id),
      fileName: String(book.fileName || ""),
      title: String(book.title || baseName(book.fileName)),
      source: normalizeSource(book.source),
      createdAt: String(book.createdAt),
      updatedAt: stamp,
      stats: normalizeStats(book.stats, book.rawText, book.chapters, book.volumes),
      reconstructed: !!book.reconstructed,
      missingFiles: Math.max(0, Number(book.missingFiles) || 0),
    };
  }

  function buildVolumeRecords(book) {
    return (book.volumes || []).map(function (volume, position) {
      const id = volume && volume.id ? String(volume.id) : "V" + pad(position + 1, 3);
      const rawTitle = String((volume && (volume.rawTitle || volume.title)) || "");
      return {
        bookId: String(book.id),
        id: id,
        index: Number.isFinite(Number(volume && volume.index)) ? Number(volume.index) : position,
        order: position,
        synthetic: !!(volume && volume.synthetic),
        number: volume && volume.number != null ? Number(volume.number) : null,
        name: String((volume && volume.name) || ""),
        title: rawTitle,
        rawTitle: rawTitle,
      };
    });
  }

  function buildChapterRecords(book) {
    const records = [];
    (book.chapters || []).forEach(function (chapter, position) {
      if (!chapter || !chapter.id) return;
      records.push(
        Object.assign({}, chapter, {
          bookId: String(book.id),
          id: String(chapter.id),
          order: position,
        }),
      );
    });
    return records;
  }

  function bookRange(bookId) {
    return IDBKeyRange.bound([String(bookId)], [String(bookId), []]);
  }

  function createSchema(db) {
    if (!db.objectStoreNames.contains("books")) {
      const books = db.createObjectStore("books", { keyPath: "id" });
      books.createIndex("updatedAt", "updatedAt", { unique: false });
    }
    if (!db.objectStoreNames.contains("sources")) {
      db.createObjectStore("sources", { keyPath: "bookId" });
    }
    if (!db.objectStoreNames.contains("volumes")) {
      const volumes = db.createObjectStore("volumes", { keyPath: ["bookId", "id"] });
      volumes.createIndex("bookId", "bookId", { unique: false });
    }
    if (!db.objectStoreNames.contains("chapters")) {
      const chapters = db.createObjectStore("chapters", { keyPath: ["bookId", "id"] });
      chapters.createIndex("bookId", "bookId", { unique: false });
    }
    if (!db.objectStoreNames.contains("settings")) {
      db.createObjectStore("settings", { keyPath: "key" });
    }
  }

  function openNamedDatabase(name, version, onUpgrade) {
    return new Promise(function (resolve, reject) {
      try {
        requireSupport();
      } catch (error) {
        reject(error);
        return;
      }

      let request;
      try {
        request =
          version == null
            ? window.indexedDB.open(name)
            : window.indexedDB.open(name, version);
      } catch (error) {
        reject(makeError("无法打开本地数据库", error));
        return;
      }

      let settled = false;
      const timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        try {
          if (request.result) request.result.close();
        } catch (error) {
          /* 忽略关闭异常 */
        }
        reject(new Error("打开本地数据库超时（可能被其他页面占用）"));
      }, OPEN_TIMEOUT);

      function finish() {
        clearTimeout(timer);
      }

      request.onupgradeneeded = function () {
        if (onUpgrade) onUpgrade(request.result);
      };

      request.onsuccess = function () {
        if (settled) {
          try {
            request.result.close();
          } catch (error) {
            /* 已超时，忽略迟到的连接 */
          }
          return;
        }
        settled = true;
        finish();
        const db = request.result;
        db.onversionchange = function () {
          try {
            db.close();
          } catch (error) {
            /* 忽略关闭异常 */
          }
          openPromise = null;
        };
        resolve(db);
      };

      request.onerror = function () {
        if (settled) return;
        settled = true;
        finish();
        reject(makeError("无法打开本地数据库", request.error));
      };

      // onblocked 不立即失败：等待 OPEN_TIMEOUT 后由上面的定时器统一降级。
      request.onblocked = function () {
        /* 等待超时 */
      };
    });
  }

  function hasLegacyDatabase() {
    if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve(false);
    if (typeof window.indexedDB.databases === "function") {
      return Promise.resolve()
        .then(function () {
          return window.indexedDB.databases();
        })
        .then(function (list) {
          return (list || []).some(function (item) {
            return item && item.name === LEGACY_DB_NAME;
          });
        })
        .catch(function () {
          return true;
        });
    }
    // 没有 databases() 的浏览器只能尝试打开；后续按 objectStoreNames 判断。
    return Promise.resolve(true);
  }

  function readStore(db, name) {
    return new Promise(function (resolve, reject) {
      let tx;
      try {
        tx = db.transaction([name], "readonly");
      } catch (error) {
        reject(makeError("读取旧数据库失败", error));
        return;
      }
      const request = tx.objectStore(name).getAll();
      request.onsuccess = function () {
        resolve(request.result || []);
      };
      request.onerror = function () {
        reject(makeError("读取旧数据库失败", request.error));
      };
    });
  }

  function countStore(db, name) {
    return new Promise(function (resolve, reject) {
      let tx;
      try {
        tx = db.transaction([name], "readonly");
      } catch (error) {
        reject(makeError("读取数据库条数失败", error));
        return;
      }
      const request = tx.objectStore(name).count();
      request.onsuccess = function () {
        resolve(Number(request.result) || 0);
      };
      request.onerror = function () {
        reject(makeError("读取数据库条数失败", request.error));
      };
    });
  }

  function writeStores(db, rowsByStore) {
    const names = Object.keys(rowsByStore);
    return new Promise(function (resolve, reject) {
      let tx;
      try {
        tx = db.transaction(names, "readwrite");
      } catch (error) {
        reject(makeError("迁移写入失败", error));
        return;
      }
      let settled = false;
      tx.oncomplete = function () {
        if (settled) return;
        settled = true;
        resolve();
      };
      tx.onerror = function () {
        if (settled) return;
        settled = true;
        reject(makeError("迁移写入失败", tx.error));
      };
      tx.onabort = function () {
        if (settled) return;
        settled = true;
        reject(makeError("迁移写入已中止", tx.error));
      };
      try {
        names.forEach(function (name) {
          const store = tx.objectStore(name);
          rowsByStore[name].forEach(function (row) {
            store.put(row);
          });
        });
      } catch (error) {
        try {
          tx.abort();
        } catch (ignore) {
          /* 事务可能已经结束 */
        }
        if (!settled) {
          settled = true;
          reject(makeError("迁移写入失败", error));
        }
      }
    });
  }

  function clearStores(db, names) {
    return new Promise(function (resolve, reject) {
      let tx;
      try {
        tx = db.transaction(names, "readwrite");
      } catch (error) {
        reject(makeError("清理迁移数据失败", error));
        return;
      }
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(makeError("清理迁移数据失败", tx.error));
      };
      tx.onabort = function () {
        reject(makeError("清理迁移数据已中止", tx.error));
      };
      names.forEach(function (name) {
        tx.objectStore(name).clear();
      });
    });
  }

  function putSettingRecord(db, key, value) {
    return new Promise(function (resolve, reject) {
      let tx;
      try {
        tx = db.transaction(["settings"], "readwrite");
      } catch (error) {
        reject(makeError("写入迁移标记失败", error));
        return;
      }
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(makeError("写入迁移标记失败", tx.error));
      };
      tx.onabort = function () {
        reject(makeError("写入迁移标记已中止", tx.error));
      };
      tx.objectStore("settings").put({ key: String(key), value: value });
    });
  }

  async function migrateLegacyData(db) {
    const newBookCount = await countStore(db, "books");
    if (newBookCount > 0) return { status: "skipped", reason: "new-not-empty" };

    if (!(await hasLegacyDatabase())) {
      return { status: "skipped", reason: "no-legacy" };
    }

    let legacy;
    try {
      legacy = await openNamedDatabase(LEGACY_DB_NAME, null);
    } catch (error) {
      return { status: "failed", error: error };
    }

    try {
      const names = STORES.filter(function (name) {
        return legacy.objectStoreNames.contains(name);
      });
      if (!names.length) return { status: "skipped", reason: "legacy-empty" };

      const rowsByStore = {};
      for (const name of names) {
        rowsByStore[name] = await readStore(legacy, name);
      }

      await writeStores(db, rowsByStore);

      for (const name of names) {
        const actual = await countStore(db, name);
        const expected = rowsByStore[name].length;
        if (actual !== expected) {
          throw new Error(
            "迁移校验失败：" + name + " 期望 " + expected + " 条，实际 " + actual + " 条",
          );
        }
      }

      await putSettingRecord(db, "legacyMigration", {
        from: LEGACY_DB_NAME,
        at: nowIso(),
      });

      return { status: "migrated", stores: names };
    } catch (error) {
      // 回滚新库，保证下次启动可以重试，也保证降级时不会留下半本书。
      try {
        await clearStores(db, STORES);
      } catch (rollbackError) {
        /* 清理失败时仍尝试降级到旧库 */
      }
      return {
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    } finally {
      try {
        legacy.close();
      } catch (error) {
        /* 忽略关闭异常 */
      }
    }
  }

  function openLegacyFallback() {
    return hasLegacyDatabase()
      .then(function (exists) {
        if (!exists) return null;
        return openNamedDatabase(LEGACY_DB_NAME, null);
      })
      .then(function (legacy) {
        if (!legacy) return null;
        if (!legacy.objectStoreNames.contains("books")) {
          legacy.close();
          return null;
        }
        return legacy;
      })
      .catch(function () {
        return null;
      });
  }

  function openDatabase() {
    return openNamedDatabase(DB_NAME, DB_VERSION, createSchema)
      .then(function (db) {
        return migrateLegacyData(db)
          .catch(function (error) {
            return {
              status: "failed",
              error: error instanceof Error ? error : new Error(String(error)),
            };
          })
          .then(function (result) {
            if (result.status !== "failed") {
              legacyMode = false;
              return db;
            }
            try {
              db.close();
            } catch (error) {
              /* 忽略关闭异常 */
            }
            return openLegacyFallback().then(function (legacy) {
              if (!legacy) throw result.error || new Error("旧数据库迁移失败");
              legacyMode = true;
              return legacy;
            });
          });
      })
      .catch(function (error) {
        // 新库打不开（例如被其他标签页阻塞）时，尽量退回旧库继续本次会话。
        return openLegacyFallback().then(function (legacy) {
          if (!legacy) throw error;
          legacyMode = true;
          return legacy;
        });
      });
  }

  function run(storeNames, mode, work) {
    return ND.db.open().then(function (db) {
      return new Promise(function (resolve, reject) {
        let tx;
        try {
          tx = db.transaction(storeNames, mode);
        } catch (error) {
          reject(makeError("无法开始数据库事务", error));
          return;
        }

        const box = { value: undefined };
        let settled = false;

        function fail(error) {
          if (settled) return;
          settled = true;
          reject(error);
        }

        tx.oncomplete = function () {
          if (settled) return;
          settled = true;
          resolve(box.value);
        };
        tx.onerror = function () {
          fail(makeError("数据库事务失败", tx.error));
        };
        tx.onabort = function () {
          fail(makeError("数据库事务已中止", tx.error));
        };

        try {
          work(tx, box);
        } catch (error) {
          try {
            tx.abort();
          } catch (ignore) {
            /* 事务可能已经结束 */
          }
          fail(makeError("数据库操作失败", error));
        }
      });
    });
  }

  function reconstruct(record, sourceRecord, volumeRecords, chapterRecords) {
    const rawText = String((sourceRecord && sourceRecord.rawText) || "");

    const volumes = volumeRecords
      .slice()
      .sort(function (a, b) {
        const delta = Number(a.index || 0) - Number(b.index || 0);
        if (delta) return delta;
        const orderDelta = Number(a.order || 0) - Number(b.order || 0);
        if (orderDelta) return orderDelta;
        return String(a.id || "").localeCompare(String(b.id || ""));
      })
      .map(function (volume) {
        return {
          id: String(volume.id),
          index: Number.isFinite(Number(volume.index)) ? Number(volume.index) : 0,
          synthetic: !!volume.synthetic,
          number: volume.number == null ? null : Number(volume.number),
          name: String(volume.name || ""),
          rawTitle: String(volume.rawTitle || volume.title || ""),
          chapters: [],
        };
      });

    const byId = new Map();
    volumes.forEach(function (volume) {
      byId.set(volume.id, volume);
    });

    const chapters = chapterRecords
      .slice()
      .sort(function (a, b) {
        return Number(a.order || 0) - Number(b.order || 0);
      })
      .map(function (recordItem) {
        const chapter = Object.assign({}, recordItem);
        delete chapter.bookId;
        delete chapter.order;
        chapter.id = String(chapter.id);
        chapter.type = chapter.type || "chapter";
        chapter.rawTitle = String(chapter.rawTitle || chapter.title || "未命名章节");
        chapter.title = String(chapter.title || chapter.rawTitle);
        chapter.body = String(chapter.body == null ? "" : chapter.body);
        chapter.text = String(chapter.text == null ? chapter.body : chapter.text);
        chapter.volumeId = String(chapter.volumeId || "");
        chapter.excluded = !!chapter.excluded;
        chapter.reasons = Array.isArray(chapter.reasons) ? chapter.reasons.slice() : [];
        chapter.junkType = chapter.junkType || (chapter.excluded ? "junk" : "normal");
        chapter.junkScore = Number(chapter.junkScore) || 0;
        return chapter;
      });

    chapters.forEach(function (chapter) {
      let volume = byId.get(chapter.volumeId);
      if (!volume) {
        volume = {
          id: chapter.volumeId || "V000",
          index: volumes.length,
          synthetic: true,
          number: null,
          name: "未分卷",
          rawTitle: "未分卷",
          chapters: [],
        };
        volumes.push(volume);
        byId.set(volume.id, volume);
        chapter.volumeId = volume.id;
      }
      volume.chapters.push(chapter);
    });

    return {
      id: String(record.id),
      fileName: String(record.fileName || ""),
      title: String(record.title || baseName(record.fileName)),
      source: normalizeSource(record.source),
      createdAt: String(record.createdAt || record.updatedAt || ""),
      updatedAt: String(record.updatedAt || ""),
      stats: normalizeStats(record.stats, rawText, chapters, volumes),
      reconstructed: !!record.reconstructed,
      missingFiles: Math.max(0, Number(record.missingFiles) || 0),
      rawText: rawText,
      volumes: volumes,
      chapters: chapters,
    };
  }

  ND.db = {
    DB_NAME: DB_NAME,
    LEGACY_DB_NAME: LEGACY_DB_NAME,
    DB_VERSION: DB_VERSION,

    isLegacy: function () {
      return !!legacyMode;
    },

    open: function () {
      if (!openPromise) {
        openPromise = openDatabase().catch(function (error) {
          openPromise = null;
          throw error instanceof Error ? error : makeError("无法打开本地数据库", error);
        });
      }
      return openPromise;
    },

    newId: function (prefix) {
      const stamp = Date.now().toString(36);
      const random = Math.random().toString(36).slice(2, 8);
      return Promise.resolve(String(prefix || "id") + "-" + stamp + "-" + random);
    },

    saveBook: function (book) {
      return Promise.resolve()
        .then(function () {
          if (!book || typeof book !== "object") throw new Error("保存失败：书籍数据为空");
          if (!book.id) throw new Error("保存失败：缺少书籍 ID");
          const record = buildBookRecord(book);
          const volumes = buildVolumeRecords(book);
          const chapters = buildChapterRecords(book);
          return run(["books", "sources", "volumes", "chapters"], "readwrite", function (tx) {
            tx.objectStore("books").put(record);
            tx.objectStore("sources").put({
              bookId: record.id,
              rawText: String(book.rawText == null ? "" : book.rawText),
            });

            const volumeStore = tx.objectStore("volumes");
            const chapterStore = tx.objectStore("chapters");
            const range = bookRange(record.id);
            volumeStore.delete(range);
            chapterStore.delete(range);

            volumes.forEach(function (volume) {
              volumeStore.put(volume);
            });
            chapters.forEach(function (chapter) {
              chapterStore.put(chapter);
            });
          });
        })
        .catch(function (error) {
          throw error instanceof Error ? error : makeError("保存失败", error);
        });
    },

    loadBook: function (id) {
      return Promise.resolve()
        .then(function () {
          if (!id) throw new Error("读取失败：缺少书籍 ID");
          const bookId = String(id);
          return run(["books", "sources", "volumes", "chapters"], "readonly", function (tx, box) {
            const bookRequest = tx.objectStore("books").get(bookId);
            bookRequest.onsuccess = function () {
              box.book = bookRequest.result || null;
            };

            const sourceRequest = tx.objectStore("sources").get(bookId);
            sourceRequest.onsuccess = function () {
              box.source = sourceRequest.result || null;
            };

            const volumeRequest = tx.objectStore("volumes").index("bookId").getAll(bookId);
            volumeRequest.onsuccess = function () {
              box.volumes = volumeRequest.result || [];
            };

            const chapterRequest = tx.objectStore("chapters").index("bookId").getAll(bookId);
            chapterRequest.onsuccess = function () {
              box.chapters = chapterRequest.result || [];
            };

            box.value = box;
          }).then(function (box) {
            const record = box && box.book;
            if (!record) return null;
            return reconstruct(record, box.source, box.volumes || [], box.chapters || []);
          });
        })
        .catch(function (error) {
          throw error instanceof Error ? error : makeError("读取失败", error);
        });
    },

    updateChapter: function (bookId, chapter) {
      return Promise.resolve()
        .then(function () {
          if (!bookId) throw new Error("保存失败：缺少书籍 ID");
          if (!chapter || !chapter.id) throw new Error("保存失败：缺少章节 ID");
          const key = [String(bookId), String(chapter.id)];
          return run(["chapters", "books"], "readwrite", function (tx) {
            const store = tx.objectStore("chapters");
            const getRequest = store.get(key);
            getRequest.onsuccess = function () {
              const existing = getRequest.result || {};
              const record = Object.assign({}, existing, chapter, {
                bookId: String(bookId),
                id: String(chapter.id),
                order:
                  chapter.order != null
                    ? chapter.order
                    : existing.order != null
                      ? existing.order
                      : 0,
              });
              store.put(record);

              const books = tx.objectStore("books");
              const bookRequest = books.get(String(bookId));
              bookRequest.onsuccess = function () {
                const bookRecord = bookRequest.result;
                if (!bookRecord) return;
                bookRecord.updatedAt = nowIso();
                books.put(bookRecord);
              };
            };
          });
        })
        .catch(function (error) {
          throw error instanceof Error ? error : makeError("保存章节失败", error);
        });
    },

    updateBook: function (book) {
      return Promise.resolve()
        .then(function () {
          if (!book || !book.id) throw new Error("保存失败：缺少书籍 ID");
          const record = buildBookRecord(book);
          return run(["books"], "readwrite", function (tx) {
            tx.objectStore("books").put(record);
          });
        })
        .catch(function (error) {
          throw error instanceof Error ? error : makeError("保存书籍失败", error);
        });
    },

    listBooks: function () {
      return Promise.resolve()
        .then(function () {
          return run(["books"], "readonly", function (tx, box) {
            const request = tx.objectStore("books").getAll();
            request.onsuccess = function () {
              const list = request.result || [];
              list.sort(function (a, b) {
                const updated = String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
                if (updated) return updated;
                return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
              });
              box.value = list;
            };
          });
        })
        .catch(function (error) {
          throw error instanceof Error ? error : makeError("读取书架失败", error);
        });
    },

    deleteBook: function (id) {
      return Promise.resolve()
        .then(function () {
          if (!id) throw new Error("删除失败：缺少书籍 ID");
          const bookId = String(id);
          return run(["books", "sources", "volumes", "chapters"], "readwrite", function (tx) {
            const range = bookRange(bookId);
            tx.objectStore("books").delete(bookId);
            tx.objectStore("sources").delete(bookId);
            tx.objectStore("volumes").delete(range);
            tx.objectStore("chapters").delete(range);
          });
        })
        .catch(function (error) {
          throw error instanceof Error ? error : makeError("删除书籍失败", error);
        });
    },

    clearAll: function () {
      return Promise.resolve()
        .then(function () {
          return run(STORES, "readwrite", function (tx) {
            STORES.forEach(function (name) {
              tx.objectStore(name).clear();
            });
          });
        })
        .catch(function (error) {
          throw error instanceof Error ? error : makeError("清空书架失败", error);
        });
    },

    getSetting: function (key, fallback) {
      return Promise.resolve()
        .then(function () {
          if (!key) throw new Error("读取设置失败：缺少键名");
          return run(["settings"], "readonly", function (tx, box) {
            const request = tx.objectStore("settings").get(String(key));
            request.onsuccess = function () {
              box.value = request.result ? request.result.value : undefined;
            };
          });
        })
        .then(function (value) {
          return value === undefined ? fallback : value;
        })
        .catch(function (error) {
          throw error instanceof Error ? error : makeError("读取设置失败", error);
        });
    },

    setSetting: function (key, value) {
      return Promise.resolve()
        .then(function () {
          if (!key) throw new Error("保存设置失败：缺少键名");
          return run(["settings"], "readwrite", function (tx) {
            tx.objectStore("settings").put({ key: String(key), value: value });
          });
        })
        .catch(function (error) {
          throw error instanceof Error ? error : makeError("保存设置失败", error);
        });
    },

    estimate: function () {
      return new Promise(function (resolve) {
        if (
          typeof navigator === "undefined" ||
          !navigator.storage ||
          typeof navigator.storage.estimate !== "function"
        ) {
          resolve({ supported: false, usage: 0, quota: 0 });
          return;
        }
        navigator.storage.estimate().then(
          function (info) {
            resolve({
              supported: true,
              usage: Number((info && info.usage) || 0),
              quota: Number((info && info.quota) || 0),
            });
          },
          function () {
            resolve({ supported: false, usage: 0, quota: 0 });
          },
        );
      });
    },
  };
})();

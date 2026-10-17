(function () {
  "use strict";

  const RP = window.RP;
  const encoder = new TextEncoder();

  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    const dateValue = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const timeValue = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    return { date: dateValue, time: timeValue };
  }

  class ZipWriter {
    constructor() {
      this.parts = [];
      this.central = [];
      this.offset = 0;
    }

    add(name, data) {
      const nameBytes = encoder.encode(String(name).replace(/^\/+/, ""));
      const bytes = typeof data === "string" ? encoder.encode(data) : data;
      const crc = crc32(bytes);
      const stamp = dosDateTime(new Date());

      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, crc, true);
      localView.setUint32(18, bytes.length, true);
      localView.setUint32(22, bytes.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, crc, true);
      centralView.setUint32(20, bytes.length, true);
      centralView.setUint32(24, bytes.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, this.offset, true);
      central.set(nameBytes, 46);

      this.parts.push(local, bytes);
      this.offset += local.length + bytes.length;
      this.central.push(central);
    }

    blob(mimeType) {
      const centralStart = this.offset;
      let centralSize = 0;
      for (const entry of this.central) centralSize += entry.length;

      const end = new Uint8Array(22);
      const view = new DataView(end.buffer);
      view.setUint32(0, 0x06054b50, true);
      view.setUint16(8, this.central.length, true);
      view.setUint16(10, this.central.length, true);
      view.setUint32(12, centralSize, true);
      view.setUint32(16, centralStart, true);

      return new Blob(this.parts.concat(this.central, [end]), {
        type: mimeType || "application/zip",
      });
    }
  }

  RP.ZipWriter = ZipWriter;

  const decoder = new TextDecoder("utf-8");

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("当前浏览器不支持解压 deflate（DecompressionStream），请更换浏览器后重试");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  RP.readZip = async function (input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!bytes.length) throw new Error("ZIP 文件为空");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    let eocd = -1;
    let fallback = -1;
    const limit = Math.max(0, bytes.length - 22 - 65535);
    for (let index = bytes.length - 22; index >= limit; index -= 1) {
      if (view.getUint32(index, true) !== 0x06054b50) continue;
      const commentLength = view.getUint16(index + 20, true);
      if (index + 22 + commentLength === bytes.length) {
        eocd = index;
        break;
      }
      if (fallback < 0) fallback = index;
    }
    if (eocd < 0) eocd = fallback;
    if (eocd < 0) throw new Error("不是有效的 ZIP 文件（未找到中央目录结尾）");

    const disk = view.getUint16(eocd + 4, true);
    const centralDisk = view.getUint16(eocd + 6, true);
    const entryCount = view.getUint16(eocd + 10, true);
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);

    if (disk !== 0 || centralDisk !== 0) throw new Error("不支持分卷 ZIP");
    if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error("不支持 ZIP64 格式");
    }
    if (centralOffset + centralSize > bytes.length) throw new Error("ZIP 中央目录不完整");

    const files = new Map();
    let offset = centralOffset;

    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error("ZIP 中央目录损坏");
      }
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replace(/\\/g, "/");
      offset += 46 + nameLength + extraLength + commentLength;

      if (flags & 0x0001) throw new Error("ZIP 已加密，无法读取：" + name);
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error("不支持 ZIP64 格式");
      }
      if (method !== 0 && method !== 8) {
        throw new Error("不支持的压缩方式（method " + method + "）：" + name);
      }
      if (/\/$/.test(name)) continue;

      if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) {
        throw new Error("ZIP 局部文件头损坏：" + name);
      }
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > bytes.length) throw new Error("ZIP 文件数据不完整：" + name);

      const raw = bytes.subarray(dataStart, dataStart + compressedSize);
      const data = method === 0 ? raw.slice() : await inflateRaw(raw);
      files.set(name.replace(/^\.\//, ""), data);
    }

    return files;
  };
})();

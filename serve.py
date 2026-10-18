#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Local-only static server for Novel-Disassembly.

Serves the project directory plus a small write API used by the browser:

  GET  /api/health  -> {"ok": true, "root": "...", "exportRoot": ".../export"}
  POST /api/export  -> writes <root>/export/<book>/<path>
  POST /api/ai/proxy -> forwards OpenAI-compatible GET/POST requests for CORS-restricted providers

The server binds 127.0.0.1 only and refuses paths that escape export/.
"""

import argparse
import base64
import binascii
import errno
import functools
import json
import os
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
EXPORT_ROOT = ROOT / "export"
MAX_BODY = 200 * 1024 * 1024
AI_MAX_BODY = 5 * 1024 * 1024
AI_MAX_RESPONSE = 20 * 1024 * 1024
AI_TIMEOUT = 90
AI_ALLOWED_HEADERS = {"authorization", "content-type", "accept", "x-api-key", "api-key"}
DEFAULT_PORT = 8765
CHUNK = 1024 * 1024

CONTROL_CHARS = set(chr(code) for code in range(0x20)) | {chr(0x7F)}
WINDOWS_RESERVED = {
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
}


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def is_within(child, parent):
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def validate_segment(segment, label):
    if not isinstance(segment, str) or not segment:
        raise ApiError(400, label + "不能为空")
    if segment in (".", ".."):
        raise ApiError(400, label + "不能是 . 或 ..")
    if any(char in CONTROL_CHARS for char in segment):
        raise ApiError(400, label + "包含控制字符")
    if any(char in segment for char in '\\/:*?"<>|'):
        raise ApiError(400, label + "包含非法字符")
    if segment != segment.strip(" ."):
        raise ApiError(400, label + "不能以点或空白开头或结尾")
    if segment.split(".")[0].lower() in WINDOWS_RESERVED:
        raise ApiError(400, label + "使用了 Windows 保留名")
    return segment


def validate_book_name(value):
    if not isinstance(value, str) or not value:
        raise ApiError(400, "book 不能为空")
    if "/" in value or "\\" in value or value.startswith("/") or (
        len(value) >= 2 and value[1] == ":" and value[0].isalpha()
    ):
        raise ApiError(400, "book 不能包含路径或盘符")
    return validate_segment(value, "book")


def validate_relative_path(value, label):
    if not isinstance(value, str) or not value:
        raise ApiError(400, label + "不能为空")
    if value.startswith("/") or value.startswith("\\"):
        raise ApiError(400, label + "不能是绝对路径")
    if len(value) >= 2 and value[1] == ":" and value[0].isalpha():
        raise ApiError(400, label + "不能包含盘符")
    if any(char in CONTROL_CHARS for char in value):
        raise ApiError(400, label + "包含控制字符")
    if "\\" in value:
        raise ApiError(400, label + "只能使用 / 作为分隔符")
    parts = value.split("/")
    for part in parts:
        validate_segment(part, label + "的每一段")
    return parts


def decode_binary(item):
    path = item.get("path")
    data = item.get("base64")
    if not isinstance(data, str):
        raise ApiError(400, "binary.base64 必须是字符串：" + str(path))
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError):
        raise ApiError(400, "binary.base64 不是有效的 Base64：" + str(path))


def prepare_export(data):
    if not isinstance(data, dict):
        raise ApiError(400, "请求体必须是 JSON 对象")
    book = validate_book_name(data.get("book"))

    raw_files = data.get("files", [])
    raw_binary = data.get("binary", [])
    if not isinstance(raw_files, list):
        raise ApiError(400, "files 必须是数组")
    if not isinstance(raw_binary, list):
        raise ApiError(400, "binary 必须是数组")

    entries = []
    seen = set()

    def add_entry(path, payload):
        parts = validate_relative_path(path, "文件路径")
        key = "/".join(parts).lower()
        if key in seen:
            raise ApiError(400, "导出路径重复：" + "/".join(parts))
        seen.add(key)
        entries.append((parts, payload))

    for item in raw_files:
        if not isinstance(item, dict):
            raise ApiError(400, "files 中的条目必须是对象")
        path = item.get("path")
        content = item.get("content", "")
        if not isinstance(content, str):
            raise ApiError(400, "files.content 必须是字符串：" + str(path))
        add_entry(path, content.encode("utf-8"))

    for item in raw_binary:
        if not isinstance(item, dict):
            raise ApiError(400, "binary 中的条目必须是对象")
        add_entry(item.get("path"), decode_binary(item))

    return book, entries


def write_export(data):
    book, entries = prepare_export(data)
    EXPORT_ROOT.mkdir(parents=True, exist_ok=True)
    base = EXPORT_ROOT.resolve()
    book_dir = base / book

    resolved_book = book_dir.resolve()
    if not is_within(resolved_book, base):
        raise ApiError(400, "book 越出 export 目录")
    if book_dir.exists() and not book_dir.is_dir():
        raise ApiError(400, "目标位置已存在同名文件：" + book)

    parent_dirs = set()
    for parts, payload in entries:
        target = book_dir.joinpath(*parts)
        resolved_target = target.resolve()
        if not is_within(resolved_target, resolved_book):
            raise ApiError(400, "文件路径越出 export 目录：" + "/".join(parts))
        parent = resolved_target.parent
        while is_within(parent, base) and parent != base:
            parent_dirs.add(parent)
            parent = parent.parent

    book_dir.mkdir(parents=True, exist_ok=True)
    for directory in sorted(parent_dirs, key=lambda item: len(item.parts)):
        directory.mkdir(parents=True, exist_ok=True)

    count = 0
    for parts, payload in entries:
        target = book_dir.joinpath(*parts)
        target.write_bytes(payload)
        count += 1

    return book, book_dir, count


def read_limited(response, limit):
    raw = response.read(limit + 1)
    if len(raw) > limit:
        raise ApiError(502, "目标响应超过 20MB 上限")
    return raw.decode("utf-8", "replace")


def proxy_ai(data):
    if not isinstance(data, dict):
        raise ApiError(400, "请求体必须是 JSON 对象")
    url = data.get("url")
    if not isinstance(url, str) or not url:
        raise ApiError(400, "url 不能为空")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise ApiError(400, "只允许 http/https 目标地址")
    if parts.username or parts.password:
        raise ApiError(400, "目标地址不能包含用户名或密码")

    method = str(data.get("method") or "GET").upper()
    if method not in ("GET", "POST"):
        raise ApiError(400, "只支持 GET / POST")

    raw_headers = data.get("headers") or {}
    if not isinstance(raw_headers, dict):
        raise ApiError(400, "headers 必须是对象")
    headers = {}
    for key, value in raw_headers.items():
        if isinstance(key, str) and isinstance(value, str) and key.lower() in AI_ALLOWED_HEADERS:
            headers[key] = value

    body = data.get("body") or ""
    if not isinstance(body, str):
        raise ApiError(400, "body 必须是字符串")
    payload = None
    if method == "POST":
        payload = body.encode("utf-8")
        if len(payload) > AI_MAX_BODY:
            raise ApiError(413, "请求体超过 5MB 上限")

    request = Request(url, data=payload, headers=headers, method=method)
    try:
        with urlopen(request, timeout=AI_TIMEOUT) as response:
            return {
                "ok": True,
                "status": response.status,
                "contentType": response.headers.get("Content-Type", ""),
                "body": read_limited(response, AI_MAX_RESPONSE),
            }
    except HTTPError as error:
        return {
            "ok": True,
            "status": error.code,
            "contentType": error.headers.get("Content-Type", "") if error.headers else "",
            "body": read_limited(error, AI_MAX_RESPONSE),
        }
    except URLError as error:
        raise ApiError(502, "无法连接目标服务：" + str(error.reason))
    except OSError as error:
        raise ApiError(502, "目标服务连接失败：" + str(error))


class Handler(SimpleHTTPRequestHandler):
    server_version = "NovelDisassembly/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        try:
            sys.stderr.write("[serve] " + (fmt % args) + "\n")
        except Exception:
            pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def guess_type(self, path):
        base = super().guess_type(path)
        lower = base.lower()
        if lower.startswith("text/") and "charset" not in lower:
            return base + "; charset=utf-8"
        if lower.startswith("application/javascript") or lower.startswith("application/json"):
            return base + "; charset=utf-8"
        return base

    def host_is_local(self):
        host = (self.headers.get("Host") or "").strip().lower()
        if host.startswith("["):
            hostname = host.split("]", 1)[0] + "]"
        else:
            hostname = host.rsplit(":", 1)[0] if ":" in host else host
        return hostname in ("127.0.0.1", "localhost", "[::1]")

    def origin_is_local(self):
        origin = (self.headers.get("Origin") or "").strip()
        if not origin:
            return True
        try:
            parts = urlsplit(origin)
        except ValueError:
            return False
        return parts.scheme in ("http", "https") and parts.hostname in ("127.0.0.1", "localhost", "::1")

    def content_type_is_json(self):
        content_type = (self.headers.get("Content-Type") or "").strip().lower()
        return content_type.startswith("application/json")

    def send_json(self, status, payload):
        body = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/api/health":
            self.send_json(200, {
                "ok": True,
                "root": str(ROOT),
                "exportRoot": str(EXPORT_ROOT),
            })
            return
        if path.startswith("/api/"):
            self.send_json(404, {"ok": False, "error": "未知接口：" + path})
            return
        super().do_GET()

    def do_HEAD(self):
        path = urlsplit(self.path).path
        if path == "/api/health":
            body = json_bytes({
                "ok": True,
                "root": str(ROOT),
                "exportRoot": str(EXPORT_ROOT),
            })
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return
        if path.startswith("/api/"):
            self.send_json(404, {"ok": False, "error": "未知接口：" + path})
            return
        super().do_HEAD()

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ("/api/export", "/api/ai/proxy"):
            self.send_json(404, {"ok": False, "error": "未知接口：" + path})
            return
        if not self.host_is_local():
            self.send_json(403, {"ok": False, "error": "仅允许从本机访问"})
            return
        if not self.origin_is_local():
            self.send_json(403, {"ok": False, "error": "仅允许本机页面调用本地接口"})
            return
        if not self.content_type_is_json():
            self.send_json(415, {"ok": False, "error": "请求必须使用 application/json"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError:
            self.send_json(400, {"ok": False, "error": "Content-Length 无效"})
            return
        if length <= 0:
            self.send_json(400, {"ok": False, "error": "请求体为空"})
            return
        limit = AI_MAX_BODY if path == "/api/ai/proxy" else MAX_BODY
        if length > limit:
            self.send_json(413, {"ok": False, "error": "请求体超过上限"})
            return

        body = self.rfile.read(length)
        if len(body) != length:
            self.send_json(400, {"ok": False, "error": "请求体不完整"})
            return
        try:
            data = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"ok": False, "error": "请求体不是有效的 UTF-8 JSON"})
            return

        if path == "/api/ai/proxy":
            try:
                result = proxy_ai(data)
            except ApiError as error:
                self.send_json(error.status, {"ok": False, "error": error.message})
                return
            except Exception as error:
                self.log_message("ai proxy failed: %s: %s", type(error).__name__, error)
                self.send_json(502, {"ok": False, "error": "代理请求失败：" + str(error)})
                return
            self.send_json(200, result)
            return

        try:
            book, book_dir, count = write_export(data)
        except ApiError as error:
            self.send_json(error.status, {"ok": False, "error": error.message})
            return
        except OSError as error:
            self.log_message("export failed: %s", error)
            self.send_json(500, {"ok": False, "error": "写入失败：" + str(error)})
            return
        except Exception as error:  # noqa: BLE001 - keep the API response JSON
            self.log_message("export failed: %s: %s", type(error).__name__, error)
            self.send_json(500, {"ok": False, "error": "写入失败：" + str(error)})
            return

        self.send_json(200, {
            "ok": True,
            "path": str(book_dir),
            "count": count,
        })


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main(argv=None):
    parser = argparse.ArgumentParser(description="Novel-Disassembly local server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="listen port (default 8765)")
    parser.add_argument("--open", action="store_true", help="open the app in the default browser")
    args = parser.parse_args(argv)

    if not 1 <= args.port <= 65535:
        print("端口必须在 1-65535 之间", file=sys.stderr)
        return 2

    url = "http://127.0.0.1:%d/" % args.port
    try:
        httpd = Server(("127.0.0.1", args.port), Handler)
    except OSError as error:
        code = getattr(error, "winerror", None) or error.errno
        if code in (errno.EADDRINUSE, 10048):
            print("端口 %d 已被占用，请关闭占用程序或使用 --port 指定其他端口" % args.port, file=sys.stderr)
        else:
            print("无法监听 127.0.0.1:%d：%s" % (args.port, error), file=sys.stderr)
        return 1

    print("Novel-Disassembly 已启动：%s" % url)
    print("项目根目录：%s" % ROOT)
    print("导出目录：%s" % EXPORT_ROOT)
    print("仅监听 127.0.0.1；按 Ctrl+C 停止。")
    sys.stdout.flush()

    if args.open:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

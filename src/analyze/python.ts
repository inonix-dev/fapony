// src/analyze/python.ts — Python import scanning + resolution.
//
// Line-based: Bun.Transpiler can't parse .py (see map.ts for why
// `python -c "import ast"` is not the answer). The module part always sits on
// the first line of a `from … import`, so a multi-line name list is a
// non-issue for the edge itself; the imported names only matter to resolve a
// submodule (`from . import sib` → `sib.py`), and the parenthesized form
// carries them on the opening line.

import {
  dirname as posixDirname,
  join as posixJoin,
  normalize as posixNormalize,
} from "node:path/posix";

import { maskPyBlocks } from "../map.js";

export interface PyImport {
  /** Leading dots (`from ..x import`) — null for absolute imports. */
  dots: string | null;
  /** Dotted module path after the dots ("" for `from . import y`). */
  mod: string;
  /** Names bound by a `from … import`; empty for a plain `import`. */
  names: string[];
}

// Frozen at the CPython 3.12 stdlib top-level set
// (https://docs.python.org/3.12/library/ — ~210 public names).
// Anything outside = `unresolved` on purpose: without `sys.path` a
// third-party package (`requests`) is indistinguishable from a miss.
export const PY_STDLIB: Set<string> = new Set([
  "__future__",
  "abc",
  "aifc",
  "argparse",
  "array",
  "ast",
  "asynchat",
  "asyncio",
  "asyncore",
  "atexit",
  "audioop",
  "base64",
  "bdb",
  "binascii",
  "binhex",
  "bisect",
  "builtins",
  "bz2",
  "calendar",
  "cgi",
  "cgitb",
  "chunk",
  "cmath",
  "cmd",
  "code",
  "codecs",
  "codeop",
  "collections",
  "colorsys",
  "compileall",
  "concurrent",
  "configparser",
  "contextlib",
  "contextvars",
  "copy",
  "copyreg",
  "cProfile",
  "crypt",
  "csv",
  "ctypes",
  "curses",
  "dataclasses",
  "datetime",
  "dbm",
  "decimal",
  "difflib",
  "dis",
  "doctest",
  "email",
  "encodings",
  "enum",
  "errno",
  "faulthandler",
  "fcntl",
  "filecmp",
  "fileinput",
  "fnmatch",
  "fractions",
  "ftplib",
  "functools",
  "gc",
  "getopt",
  "getpass",
  "gettext",
  "glob",
  "graphlib",
  "grp",
  "gzip",
  "hashlib",
  "heapq",
  "hmac",
  "html",
  "http",
  "idlelib",
  "imaplib",
  "imghdr",
  "imp",
  "importlib",
  "inspect",
  "io",
  "ipaddress",
  "itertools",
  "json",
  "keyword",
  "lib2to3",
  "linecache",
  "locale",
  "logging",
  "lzma",
  "mailbox",
  "mailcap",
  "marshal",
  "math",
  "mimetypes",
  "mmap",
  "modulefinder",
  "multiprocessing",
  "netrc",
  "nis",
  "nntplib",
  "numbers",
  "operator",
  "optparse",
  "os",
  "ossaudiodev",
  "pathlib",
  "pdb",
  "pickle",
  "pickletools",
  "pipes",
  "pkgutil",
  "platform",
  "plistlib",
  "poplib",
  "posix",
  "pprint",
  "profile",
  "pstats",
  "pty",
  "pwd",
  "py_compile",
  "pyclbr",
  "pydoc",
  "queue",
  "quopri",
  "random",
  "re",
  "readline",
  "reprlib",
  "resource",
  "rlcompleter",
  "runpy",
  "sched",
  "secrets",
  "select",
  "selectors",
  "shelve",
  "shlex",
  "shutil",
  "signal",
  "site",
  "smtpd",
  "smtplib",
  "sndhdr",
  "socket",
  "socketserver",
  "sqlite3",
  "ssl",
  "stat",
  "statistics",
  "string",
  "stringprep",
  "struct",
  "subprocess",
  "sunau",
  "symtable",
  "sys",
  "sysconfig",
  "syslog",
  "tabnanny",
  "tarfile",
  "telnetlib",
  "tempfile",
  "termios",
  "test",
  "textwrap",
  "threading",
  "time",
  "timeit",
  "tkinter",
  "token",
  "tokenize",
  "tomllib",
  "trace",
  "traceback",
  "tracemalloc",
  "tty",
  "turtle",
  "types",
  "typing",
  "unicodedata",
  "unittest",
  "urllib",
  "uuid",
  "venv",
  "warnings",
  "wave",
  "weakref",
  "webbrowser",
  "wsgiref",
  "xdrlib",
  "xml",
  "xmlrpc",
  "zipapp",
  "zipfile",
  "zipimport",
  "zlib",
  "zoneinfo",
]);

/** Root segment of an absolute import (`os.path` → `os`). */
export function pyRootSegment(mod: string): string {
  const dot = mod.indexOf(".");
  return dot === -1 ? mod : mod.slice(0, dot);
}

// Imported names, before any `as` alias — the submodule is the name on the
// left, not the alias. `*` and non-identifiers are dropped.
export function pyImportNames(rest: string): string[] {
  const clean = rest.replace(/[()]/g, " ");
  const out: string[] = [];
  for (let part of clean.split(",")) {
    part = part.trim().split("#")[0].trim();
    if (!part || part === "*") continue;
    const name = part.split(/\s+as\s+/)[0].trim();
    if (/^[A-Za-z_]\w*$/.test(name)) out.push(name);
  }
  return out;
}

export function scanPythonImports(content: string): PyImport[] {
  const out: PyImport[] = [];
  // Blank strings/docstrings first — a `from .x import y` written inside one
  // is sample text, not an edge.
  for (const rawLine of maskPyBlocks(content).split("\n")) {
    // Safe to cut at the first `#`: import/from lines carry only
    // identifiers, dots, commas, parens, `as`, and `*` — never a `#` string.
    const line = rawLine.split("#")[0];
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^[ \t]*from\s*(\.+)?([\w.]*)\s+import\s+(.+)/))) {
      out.push({ dots: m[1] ?? null, mod: m[2], names: pyImportNames(m[3]) });
    } else if ((m = line.match(/^[ \t]*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/))) {
      // Plain `import` is always absolute in Python 3 (relative needs `from`).
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+/)[0];
        if (name) out.push({ dots: null, mod: name, names: [] });
      }
    }
  }
  return out;
}

// Dots count folder levels: 1 = the importer's own dir, 2 = its parent, and
// so on. Each level then tries `x.py` and `x/__init__.py`.
export function resolvePythonRelative(
  importerRel: string,
  dots: string,
  mod: string,
  filesSet: Set<string>,
): string | null {
  let dir = posixDirname(importerRel);
  for (let i = 1; i < dots.length; i++) {
    if (dir === ".") return null; // climbs above the scanned root
    dir = posixDirname(dir);
  }
  const base = mod ? posixJoin(dir, ...mod.split(".")) : dir;
  const norm = posixNormalize(base);
  const candidates =
    norm === "."
      ? ["__init__.py"]
      : mod
        ? [`${norm}.py`, `${norm}/__init__.py`]
        : [`${norm}/__init__.py`];
  for (const c of candidates) {
    if (filesSet.has(c)) return c;
  }
  return null;
}

// Dotted module path → file, so an absolute `import pkg.mod` / `from pkg.mod
// import x` resolves when the target is in this repo. A file is indexed under
// each ancestor dir that is not itself a package (no `__init__.py`) — the repo
// root and a `src`-style root both qualify, so `mypkg.core` finds
// `src/mypkg/core.py` while a bare `core` never does. Shortest path wins a clash.
export function buildPyModuleIndex(filesSet: Set<string>): Map<string, string> {
  const index = new Map<string, string>();
  const put = (mod: string, file: string): void => {
    const prev = index.get(mod);
    if (!prev || file.length < prev.length) index.set(mod, file);
  };
  for (const file of filesSet) {
    if (!file.endsWith(".py")) continue;
    const parts = file.slice(0, -3).split("/");
    if (parts[parts.length - 1] === "__init__") parts.pop();
    for (let start = 0; start < parts.length; start++) {
      const rootDir = parts.slice(0, start).join("/");
      const prefix = rootDir ? `${rootDir}/` : "";
      if (filesSet.has(`${prefix}__init__.py`)) continue; // a package, not a root
      put(parts.slice(start).join("."), file);
    }
  }
  return index;
}

// Every file a single import reaches: the module itself, plus each imported
// name that is a real submodule (`from . import sib` → `sib.py`; the package
// `__init__.py` is imported too, so it stays an edge). Self-edges are dropped
// — `from . import x` inside `__init__.py` must not point at itself.
export function resolvePythonImport(
  importerRel: string,
  imp: PyImport,
  filesSet: Set<string>,
  moduleIndex: Map<string, string>,
): Set<string> {
  const hits = new Set<string>();
  if (imp.dots) {
    let dir = posixDirname(importerRel);
    for (let i = 1; i < imp.dots.length; i++) {
      if (dir === ".") return hits; // climbs above the scanned root
      dir = posixDirname(dir);
    }
    const base = imp.mod
      ? posixNormalize(posixJoin(dir, ...imp.mod.split(".")))
      : dir;
    for (const name of imp.names) {
      for (const c of [`${base}/${name}.py`, `${base}/${name}/__init__.py`]) {
        if (filesSet.has(c)) hits.add(c);
      }
    }
    const selfCands = imp.mod
      ? [`${base}.py`, `${base}/__init__.py`]
      : [`${base}/__init__.py`];
    for (const c of selfCands) {
      if (filesSet.has(c)) {
        hits.add(c);
        break;
      }
    }
  } else {
    for (const name of imp.names) {
      const hit = moduleIndex.get(imp.mod ? `${imp.mod}.${name}` : name);
      if (hit) hits.add(hit);
    }
    const self = moduleIndex.get(imp.mod);
    if (self) hits.add(self);
  }
  hits.delete(importerRel);
  return hits;
}

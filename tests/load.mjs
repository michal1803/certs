// Loads the browser scripts (plain IIFEs that set window.*) into an isolated
// context with just enough of a browser to run their pure logic: an in-memory
// localStorage, no network, no DOM.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function memoryStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    // Object.keys(localStorage) in the app lists the stored keys.
    _keys: () => [...m.keys()],
  };
}

export function load(files, { storage = memoryStorage(), pushUrl = "" } = {}) {
  const events = [];
  // A Proxy so Object.keys(localStorage) returns the stored keys, as in a browser.
  const localStorage = new Proxy(storage, {
    ownKeys: t => t._keys(),
    getOwnPropertyDescriptor: (t, k) => (t._keys().includes(k) ? { enumerable: true, configurable: true, value: t.getItem(k) } : undefined),
  });
  const win = {
    localStorage,
    PUSH_URL: pushUrl,
    location: { hash: "", href: "http://localhost/index.html", protocol: "http:" },
    navigator: { onLine: true, userAgent: "node" },
    document: { addEventListener() {}, documentElement: { dataset: {} } },
    addEventListener() {},
    dispatchEvent(e) { events.push(e); return true; },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    setTimeout: () => 0, clearTimeout() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    console, JSON, Math, Date, Promise, Array, Object, Number, String, Set, Map, Error, Intl,
    TextEncoder, crypto: globalThis.crypto,
  };
  win.window = win; win.self = win;
  const ctx = vm.createContext(win);
  for (const f of files) vm.runInContext(readFileSync(join(root, f), "utf8"), ctx, { filename: f });
  return { win, events };
}

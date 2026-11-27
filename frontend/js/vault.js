/* Vault adapters: one interface, two back-ends.
   - ServerAdapter: talks to the FastAPI backend (vault on a server).
   - LocalAdapter: uses the File System Access API (local folder, no backend).
   Interface: name, readOnly, tree, readText(path), writeText(path, txt),
   fileURL(path) -> URL usable in <img>. */
"use strict";

export class ServerAdapter {
  constructor() { this.mode = "server"; this.tree = []; this.name = "vault"; this.readOnly = false; }
  static async detect() {
    try {
      const r = await fetch("/api/meta");
      if (!r.ok) return null;
      const meta = await r.json();
      const a = new ServerAdapter();
      a.name = meta.vault || "vault";
      a.readOnly = !!meta.read_only;
      return a;
    } catch { return null; }
  }
  async loadTree() {
    const { tree } = await (await fetch("/api/tree")).json();
    this.tree = tree; return tree;
  }
  async readText(path) {
    const r = await fetch("/api/file?path=" + encodeURIComponent(path));
    if (!r.ok) throw new Error("read " + path);
    return r.text();
  }
  async writeText(path, content) {
    const r = await fetch("/api/file?path=" + encodeURIComponent(path), {
      method: "PUT", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: content });
    if (!r.ok) throw new Error(await r.text());
  }
  async allFiles() {
    try { return (await (await fetch("/api/files")).json()).files || []; } catch { return []; }
  }
  async fileURL(path) { return "/api/raw?path=" + encodeURIComponent(path); }
}

export class LocalAdapter {
  constructor(dirHandle) {
    this.mode = "local"; this.dir = dirHandle; this.name = dirHandle.name;
    this.readOnly = false; this.tree = [];
    this.files = new Map();  // path -> FileSystemFileHandle
    this.dirs = new Map();   // path -> FileSystemDirectoryHandle
    this._urls = new Map();  // blob URL cache
  }
  static supported() { return typeof window !== "undefined" && "showDirectoryPicker" in window; }
  static async open() {
    const dir = await window.showDirectoryPicker({ mode: "readwrite" });
    const perm = await dir.requestPermission({ mode: "readwrite" });
    const a = new LocalAdapter(dir);
    a.readOnly = perm !== "granted";
    return a;
  }
  async loadTree() {
    this.files.clear(); this.dirs.clear();
    this.tree = await this._walk(this.dir, "");
    return this.tree;
  }
  async _walk(dirHandle, prefix) {
    const items = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (name.startsWith(".")) continue;
      const path = prefix ? prefix + "/" + name : name;
      if (handle.kind === "directory") {
        this.dirs.set(path, handle);
        const children = await this._walk(handle, path);
        if (children.length) items.push({ type: "dir", name, path, children });
      } else {
        this.files.set(path, handle);
        if (name.toLowerCase().endsWith(".md"))
          items.push({ type: "file", name: name.replace(/\.md$/i, ""), path });
        else if (name.toLowerCase().endsWith(".base"))
          items.push({ type: "file", name: name.replace(/\.base$/i, ""), path, kind: "base" });
      }
    }
    items.sort((a, b) => a.type === b.type
      ? a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      : (a.type === "dir" ? -1 : 1));
    return items;
  }
  async readText(path) {
    const h = this.files.get(path);
    if (!h) throw new Error("not found " + path);
    return (await h.getFile()).text();
  }
  async _handleForWrite(path) {
    if (this.files.has(path)) return this.files.get(path);
    const parts = path.split("/"); const name = parts.pop();
    let dir = this.dir;
    for (const seg of parts) dir = await dir.getDirectoryHandle(seg, { create: true });
    const h = await dir.getFileHandle(name, { create: true });
    this.files.set(path, h);
    return h;
  }
  async writeText(path, content) {
    const h = await this._handleForWrite(path);
    const w = await h.createWritable();
    await w.write(content); await w.close();
  }
  async allFiles() { return [...this.files.keys()]; }
  async fileURL(path) {
    if (this._urls.has(path)) return this._urls.get(path);
    const h = this.files.get(path);
    if (!h) return "";
    const url = URL.createObjectURL(await h.getFile());
    this._urls.set(path, url);
    return url;
  }
}

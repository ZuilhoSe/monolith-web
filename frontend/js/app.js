/* Monolith — app (glue). Dual-mode, rich rendering, search, quick-switcher,
   backlinks and an Obsidian-style UI. */
"use strict";
import { ServerAdapter, LocalAdapter } from "./vault.js";
import { mountInto } from "./render.js";
import { buildNoteIndex, resolveNote, Indexer } from "./search.js";
import { renderGraph } from "./graph.js";

const el = {};
["app", "ribbon", "landing", "open-folder", "unsupported", "vault-name", "mode-badge",
 "filter", "tree", "search-input", "search-results", "index-state",
 "pane-files", "pane-search", "view", "scroll", "graph-host", "backlinks", "editor",
 "rib-graph", "tabs", "tab-new", "btn-edit", "btn-save", "btn-cancel", "save-state",
 "statusbar", "sb-backlinks", "sb-count", "rib-about", "sidebar", "toast",
 "vault-switcher", "vs-name",
 "about", "about-mode", "about-vault", "about-open", "about-note", "about-close",
 "switcher", "switcher-input", "switcher-results"].forEach((id) => el[id] = document.getElementById(id));

const S = { adapter: null, index: null, indexer: null, basenames: new Map(),
  current: null, raw: "", editing: false, readOnly: false, tabs: [], active: -1 };

if (window.marked) window.marked.setOptions({ gfm: true, breaks: false });

/* ---------- boot ---------- */
(async function boot() {
  const srv = await ServerAdapter.detect();
  if (srv) return start(srv);
  el.landing.hidden = false;
  if (!LocalAdapter.supported()) { el.unsupported.hidden = false; el["open-folder"].disabled = true; }
  el["open-folder"].addEventListener("click", async () => {
    try { start(await LocalAdapter.open()); } catch { /* cancelled */ }
  });
})();

async function start(adapter) {
  S.adapter = adapter; S.readOnly = adapter.readOnly;
  S.current = null; S.editing = false; S.basenames = new Map(); S.indexer = null;
  S.tabs = []; S.active = -1;
  el.landing.hidden = true; el.app.hidden = false;
  el["vault-name"].textContent = adapter.name;
  el["vs-name"].textContent = adapter.name;
  el["mode-badge"].textContent = adapter.mode === "local" ? "Local" : "Server";
  el["mode-badge"].className = "mode-badge " + adapter.mode;

  const tree = await adapter.loadTree();
  S.index = buildNoteIndex(tree);
  el.tree.innerHTML = ""; el.tree.appendChild(renderTree(tree));

  try {
    for (const p of await adapter.allFiles()) {
      const base = p.split("/").pop().toLowerCase();
      if (!S.basenames.has(base)) S.basenames.set(base, p);
    }
  } catch { /* ok */ }

  S.indexer = new Indexer(S.index);
  el["index-state"].textContent = "indexing…";
  S.indexer.build(adapter, (d, t) => {
    el["index-state"].textContent = d < t ? `indexing ${d}/${t}…` : `${t} notes indexed`;
    if (d >= t && S.current) { showBacklinks(S.current); updateStatus(); if (el["search-input"].value) runSearch(); }
  });
  wireUI();
  newTab();   // start with an empty tab
}

/* ---------- file tree ---------- */
function renderTree(nodes) {
  const ul = document.createElement("ul");
  for (const n of nodes) {
    const li = document.createElement("li");
    if (n.type === "dir") {
      li.className = "dir";
      const row = nodeRow("▾", n.name, false);
      row.addEventListener("click", () => li.classList.toggle("collapsed"));
      li.appendChild(row); li.appendChild(renderTree(n.children));
    } else {
      const row = nodeRow("📄", n.name, true); row.dataset.path = n.path;
      row.addEventListener("click", () => openNote(n.path));
      li.appendChild(row);
    }
    ul.appendChild(li);
  }
  return ul;
}
function nodeRow(ico, name, isFile) {
  const d = document.createElement("div"); d.className = "node";
  d.innerHTML = `<span class="${isFile ? "file-ico" : "ico"}"></span><span class="label"></span>`;
  d.querySelector(isFile ? ".file-ico" : ".ico").textContent = ico;
  d.querySelector(".label").textContent = name; return d;
}

/* ---------- open / render ---------- */
const ctx = () => ({
  adapter: S.adapter, readOnly: S.readOnly,
  resolveNote: (t) => resolveNote(S.index, t),
  resolvePath: (t) => t.includes("/") ? t : (S.basenames.get(t.toLowerCase()) || t),
  onNavigate: (p) => openNote(p),
  onToggleTask: async (newRaw) => { S.raw = newRaw; try { await S.adapter.writeText(S.current, newRaw); } catch {} updateStatus(); },
});

async function openNote(path) {
  if (S.editing && !confirmDiscard()) return;
  const existing = S.tabs.findIndex((t) => t.path === path);
  if (existing >= 0) S.active = existing;
  else if (S.active < 0) { S.tabs.push({ path }); S.active = S.tabs.length - 1; }
  else S.tabs[S.active] = { path };
  renderTabs();
  await loadIntoView(path);
  closeSwitcher();
  if (window.matchMedia("(max-width:760px)").matches) el.sidebar?.classList?.remove("open");
}

async function loadIntoView(path) {
  try {
    S.raw = await S.adapter.readText(path);
    S.current = path; S.editing = false;
    highlight(path);
    await renderView();
    showBacklinks(path); updateStatus();
  } catch {
    S.current = null; el.scroll.hidden = false; el.editor.hidden = true; el.backlinks.hidden = true;
    el.view.innerHTML = `<p class="err">Couldn't open the note.</p>`;
  }
}

/* ---------- tabs ---------- */
function tabName(t) {
  if (t.graph) return "Graph";
  if (!t.path) return "New tab";
  return (S.index && S.index.flat.find((f) => f.path === t.path)?.name) || t.path.replace(/\.md$/i, "");
}
function renderTabs() {
  el.tabs.innerHTML = "";
  S.tabs.forEach((t, i) => {
    const d = document.createElement("div");
    d.className = "tab-item" + (i === S.active ? " active" : "");
    d.innerHTML = `<span class="tab-label"></span><span class="tab-close" title="Close tab">×</span>`;
    d.querySelector(".tab-label").textContent = tabName(t);
    d.addEventListener("click", (e) => {
      if (e.target.classList.contains("tab-close")) { e.stopPropagation(); closeTab(i); }
      else activateTab(i);
    });
    el.tabs.appendChild(d);
  });
}
function activateTab(i) {
  if (i === S.active) return;
  if (S.editing && !confirmDiscard()) return;
  S.active = i; renderTabs();
  const t = S.tabs[i];
  if (t.graph) showGraph(); else if (t.path) loadIntoView(t.path); else showEmptyTab();
}
function newTab() {
  if (S.editing && !confirmDiscard()) return;
  S.tabs.push({ path: null }); S.active = S.tabs.length - 1;
  renderTabs(); showEmptyTab();
}
function closeTab(i) {
  S.tabs.splice(i, 1);
  if (!S.tabs.length) { S.tabs = [{ path: null }]; S.active = 0; }
  else if (S.active > i) S.active--;
  else if (S.active >= S.tabs.length) S.active = S.tabs.length - 1;
  renderTabs();
  const t = S.tabs[S.active];
  if (t.graph) showGraph(); else if (t.path) loadIntoView(t.path); else showEmptyTab();
}

/* ---------- graph view ---------- */
function openGraphTab() {
  if (S.editing && !confirmDiscard()) return;
  if (S.active >= 0 && !S.tabs[S.active].path && !S.tabs[S.active].graph) S.tabs[S.active] = { graph: true };
  else { S.tabs.push({ graph: true }); S.active = S.tabs.length - 1; }
  renderTabs(); showGraph();
}
function showGraph() {
  S.current = null; S.editing = false; highlight(null);
  el.scroll.hidden = true; el.editor.hidden = true; el["graph-host"].hidden = false;
  el["btn-edit"].hidden = el["btn-save"].hidden = el["btn-cancel"].hidden = true;
  el["save-state"].textContent = "";
  const idx = new Map(), nodes = [], edges = [];
  S.index.flat.forEach((f, i) => {
    idx.set(f.path, i);
    nodes.push({ id: f.path, name: f.name, x: (Math.random() - 0.5) * 300, y: (Math.random() - 0.5) * 300, vx: 0, vy: 0, deg: 0 });
  });
  if (S.indexer) {
    for (const [path, d] of S.indexer.docs) {
      const a = idx.get(path); if (a == null) continue;
      for (const target of d.links) {
        const b = idx.get(target); if (b == null || b === a) continue;
        edges.push([a, b]); nodes[a].deg++; nodes[b].deg++;
      }
    }
  }
  el["sb-count"].textContent = `${nodes.length} notes · ${edges.length} links`;
  el["sb-backlinks"].textContent = S.indexer && S.indexer.ready ? "" : "indexing…";
  renderGraph(el["graph-host"], nodes, edges, (path) => openNote(path));
}
function showEmptyTab() {
  S.current = null; S.editing = false;
  el.scroll.hidden = false; el["graph-host"].hidden = true; el.editor.hidden = true; el.backlinks.hidden = true;
  el["btn-edit"].hidden = el["btn-save"].hidden = el["btn-cancel"].hidden = true;
  el["save-state"].textContent = "";
  el["sb-backlinks"].textContent = ""; el["sb-count"].textContent = "";
  highlight(null);
  el.view.innerHTML = `<div class="empty-tab">
    <a data-act="new">✏️ Create new note <kbd>Ctrl+N</kbd></a>
    <a data-act="open">🔍 Go to file <kbd>Ctrl+O</kbd></a>
    <a data-act="close">✕ Close tab</a></div>`;
  el.view.querySelectorAll(".empty-tab a").forEach((a) => a.addEventListener("click", () => {
    const act = a.dataset.act;
    if (act === "new") newNote();
    else if (act === "open") openSwitcher();
    else if (act === "close") closeTab(S.active);
  }));
}

async function renderView() {
  el.editor.hidden = true; el["graph-host"].hidden = true; el.scroll.hidden = false;
  await mountInto(el.view, S.raw, ctx());
  el["btn-edit"].hidden = S.readOnly;
  el["btn-save"].hidden = el["btn-cancel"].hidden = true;
  el["save-state"].textContent = ""; el.scroll.scrollTop = 0;
}

function showBacklinks(path) {
  if (!S.indexer || !S.indexer.ready) { el.backlinks.hidden = true; return; }
  const links = S.indexer.backlinks(path);
  if (!links.length) { el.backlinks.hidden = true; return; }
  el.backlinks.hidden = false;
  el.backlinks.innerHTML = `<div class="bl-title">${links.length} backlink${links.length > 1 ? "s" : ""}</div>`;
  const list = document.createElement("div"); list.className = "bl-list";
  for (const l of links) {
    const a = document.createElement("a"); a.className = "bl-item"; a.textContent = l.name;
    a.addEventListener("click", () => openNote(l.path)); list.appendChild(a);
  }
  el.backlinks.appendChild(list);
}

function updateStatus() {
  if (!S.current) { el["sb-backlinks"].textContent = ""; el["sb-count"].textContent = ""; return; }
  const words = (S.raw.trim().match(/\S+/g) || []).length;
  el["sb-count"].textContent = `${words} word${words === 1 ? "" : "s"} · ${S.raw.length} characters`;
  if (S.indexer && S.indexer.ready) {
    const n = S.indexer.backlinks(S.current).length;
    el["sb-backlinks"].textContent = `${n} backlink${n === 1 ? "" : "s"}`;
  } else el["sb-backlinks"].textContent = "";
}

/* ---------- editing ---------- */
function startEdit() {
  S.editing = true; el.scroll.hidden = true; el.editor.hidden = false; el.editor.value = S.raw;
  el["btn-edit"].hidden = true;
  el["btn-save"].hidden = el["btn-cancel"].hidden = false;
  el.editor.focus();
}
async function save() {
  if (!S.current) return;
  el["save-state"].className = "save-state"; el["save-state"].textContent = "saving…";
  try {
    await S.adapter.writeText(S.current, el.editor.value);
    S.raw = el.editor.value; S.editing = false;
    await renderView(); showBacklinks(S.current); updateStatus();
    el["save-state"].className = "save-state ok"; el["save-state"].textContent = "✓ saved";
    setTimeout(() => (el["save-state"].textContent = ""), 2500);
    if (S.indexer && S.indexer.ready) reindexOne(S.current, S.raw);
  } catch { el["save-state"].className = "save-state err"; el["save-state"].textContent = "✗ save failed"; }
}
function reindexOne(path, text) {
  const links = new Set(); const re = /!?\[\[([^\]]+?)\]\]/g; let m;
  while ((m = re.exec(text))) { const p = resolveNote(S.index, m[1].split("|")[0]); if (p) links.add(p); }
  const name = S.index.flat.find((f) => f.path === path)?.name || path;
  S.indexer.docs.set(path, { name, lower: text.toLowerCase(), links });
}
function cancelEdit() {
  if (el.editor.value !== S.raw && !confirmDiscard()) return;
  S.editing = false; renderView(); showBacklinks(S.current); updateStatus();
}
function confirmDiscard() { return !S.editing || el.editor.value === S.raw || confirm("Discard unsaved changes?"); }

/* ---------- search / switcher ---------- */
function runSearch() {
  const q = el["search-input"].value.trim();
  if (!S.indexer || !S.indexer.ready) { el["search-results"].innerHTML = `<div class="hint">indexing, please wait…</div>`; return; }
  const res = S.indexer.search(q);
  el["search-results"].innerHTML = "";
  if (!q) return;
  if (!res.length) { el["search-results"].innerHTML = `<div class="hint">no results</div>`; return; }
  for (const r of res) {
    const d = document.createElement("div"); d.className = "result";
    d.innerHTML = `<div class="r-name"></div><div class="r-snip"></div>`;
    d.querySelector(".r-name").textContent = r.name;
    d.querySelector(".r-snip").textContent = r.snippet;
    d.addEventListener("click", () => openNote(r.path));
    el["search-results"].appendChild(d);
  }
}

let swSel = 0;
function openSwitcher() { el.switcher.hidden = false; el["switcher-input"].value = ""; renderSwitcher(""); el["switcher-input"].focus(); }
function closeSwitcher() { el.switcher.hidden = true; }
function quickList(q) { return new Indexer(S.index).quickSwitch(q); }
function renderSwitcher(q) {
  const items = quickList(q); swSel = 0;
  el["switcher-results"].innerHTML = "";
  items.forEach((f, i) => {
    const d = document.createElement("div"); d.className = "sw-item" + (i === 0 ? " sel" : "");
    d.innerHTML = `<span class="sw-name"></span><span class="sw-path"></span>`;
    d.querySelector(".sw-name").textContent = f.name;
    d.querySelector(".sw-path").textContent = f.path;
    d.addEventListener("click", () => openNote(f.path));
    el["switcher-results"].appendChild(d);
  });
}
function moveSwitcher(delta) {
  const items = [...el["switcher-results"].children]; if (!items.length) return;
  items[swSel]?.classList.remove("sel");
  swSel = (swSel + delta + items.length) % items.length;
  items[swSel].classList.add("sel"); items[swSel].scrollIntoView({ block: "nearest" });
}

/* ---------- UI ---------- */
function highlight(path) {
  el.tree.querySelectorAll(".node.active").forEach((n) => n.classList.remove("active"));
  if (!path) return;
  const row = el.tree.querySelector(`.node[data-path="${CSS.escape(path)}"]`);
  if (row) row.classList.add("active");
}
function filterTree(q) {
  q = q.trim().toLowerCase();
  el.tree.querySelectorAll("li").forEach((li) => {
    if (li.classList.contains("dir")) {
      const any = [...li.querySelectorAll("li:not(.dir) .label")].some((l) => l.textContent.toLowerCase().includes(q));
      li.style.display = (!q || any) ? "" : "none";
    } else {
      const label = li.querySelector(".label").textContent.toLowerCase();
      li.style.display = (!q || label.includes(q)) ? "" : "none";
    }
  });
}
function switchPane(pane) {
  el.ribbon.querySelectorAll(".rib[data-pane]").forEach((r) => r.classList.toggle("active", r.dataset.pane === pane));
  el["pane-files"].hidden = pane !== "files";
  el["pane-search"].hidden = pane !== "search";
  if (pane === "search") el["search-input"].focus();
}

/* ---------- About / switch vault ---------- */
function openAbout() {
  const a = S.adapter, local = a && a.mode === "local";
  el["about-mode"].textContent = a ? (local ? "Local (browser folder)" : "Server") : "—";
  el["about-vault"].textContent = a ? a.name : "—";
  const sup = LocalAdapter.supported();
  el["about-open"].textContent = local ? "📂 Switch vault folder" : "📂 Open local folder (switch vault)";
  el["about-open"].disabled = !sup;
  el["about-note"].textContent = !sup ? "Your browser can't open local folders (use Chrome/Edge)."
    : (a && a.mode === "server" ? "Switches to local mode; to go back to the server, reload the page." : "");
  el.about.hidden = false;
}
function closeAbout() { el.about.hidden = true; }

/* ---------- toast / actions ---------- */
let _toastT;
function toast(msg) {
  el.toast.textContent = msg; el.toast.hidden = false;
  clearTimeout(_toastT); _toastT = setTimeout(() => (el.toast.hidden = true), 2200);
}
function soon(name) { toast("🚧 " + name + " — coming soon"); }
function toggleSidebar() { el.app.classList.toggle("sidebar-hidden"); }
function collapseAll() { el.tree.querySelectorAll("li.dir").forEach((d) => d.classList.add("collapsed")); }
async function newNote() {
  if (S.readOnly) { toast("Read-only vault"); return; }
  const name = (prompt("New note name:", "Untitled") || "").trim();
  if (!name) return;
  const path = name.endsWith(".md") ? name : name + ".md";
  const body = "# " + name.replace(/\.md$/i, "") + "\n\n";
  try {
    await S.adapter.writeText(path, body);
    const tree = await S.adapter.loadTree();
    S.index = buildNoteIndex(tree);
    el.tree.innerHTML = ""; el.tree.appendChild(renderTree(tree));
    try { for (const p of await S.adapter.allFiles()) { const b = p.split("/").pop().toLowerCase(); if (!S.basenames.has(b)) S.basenames.set(b, p); } } catch {}
    if (S.indexer && S.indexer.ready) reindexOne(path, body);
    await openNote(path); startEdit();
    toast("Note created");
  } catch { toast("Error creating note"); }
}

function handleRib(r) {
  if (r.dataset.pane) switchPane(r.dataset.pane);
  else if (r.dataset.soon) soon(r.dataset.soon);
  else if (r.dataset.action === "toggle-sidebar") toggleSidebar();
}
function handleFt(b) {
  if (b.dataset.action === "new-note") newNote();
  else if (b.dataset.action === "collapse-all") collapseAll();
  else if (b.dataset.soon) soon(b.dataset.soon);
}

let _wired = false;
function wireUI() {
  if (_wired) return;            // idempotent: start() runs again when switching vaults
  _wired = true;
  el.ribbon.querySelectorAll(".rib").forEach((r) => { if (r.id !== "rib-about") r.addEventListener("click", () => handleRib(r)); });
  document.querySelectorAll(".file-toolbar .ft").forEach((b) => b.addEventListener("click", () => handleFt(b)));
  el["vault-switcher"].addEventListener("click", openAbout);
  el["rib-about"].addEventListener("click", openAbout);
  el["rib-graph"].addEventListener("click", openGraphTab);
  el["tab-new"].addEventListener("click", newTab);
  el["vault-name"].addEventListener("click", openAbout);
  el["about-close"].addEventListener("click", closeAbout);
  el.about.addEventListener("click", (e) => { if (e.target === el.about) closeAbout(); });
  el["about-open"].addEventListener("click", async () => { try { closeAbout(); await start(await LocalAdapter.open()); } catch {} });
  el["btn-edit"].addEventListener("click", startEdit);
  el["btn-save"].addEventListener("click", save);
  el["btn-cancel"].addEventListener("click", cancelEdit);
  el.filter.addEventListener("input", (e) => filterTree(e.target.value));
  el["search-input"].addEventListener("input", runSearch);
  el["switcher-input"].addEventListener("input", (e) => renderSwitcher(e.target.value));
  el["switcher-input"].addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveSwitcher(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveSwitcher(-1); }
    else if (e.key === "Enter") { e.preventDefault(); const f = quickList(el["switcher-input"].value)[swSel]; if (f) openNote(f.path); }
    else if (e.key === "Escape") closeSwitcher();
  });
  el.switcher.addEventListener("click", (e) => { if (e.target === el.switcher) closeSwitcher(); });

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "o" || e.key === "p")) { e.preventDefault(); openSwitcher(); }
    else if (mod && e.key === "s" && S.editing) { e.preventDefault(); save(); }
    else if (mod && e.key === "e" && S.current && !S.readOnly) { e.preventDefault(); S.editing ? cancelEdit() : startEdit(); }
    else if (mod && e.shiftKey && (e.key === "f" || e.key === "F")) { e.preventDefault(); switchPane("search"); }
    else if (e.key === "Escape") { if (!el.about.hidden) closeAbout(); else if (!el.switcher.hidden) closeSwitcher(); }
  });
}

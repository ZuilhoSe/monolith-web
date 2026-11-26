/* Obsidian Web — frontend (vanilla JS, sem build) */
"use strict";

const $ = (s) => document.querySelector(s);
const el = {
  tree: $("#tree"), filter: $("#filter"), vault: $("#vault-name"),
  crumb: $("#crumb"), view: $("#view"), editor: $("#editor"),
  welcome: $("#welcome"), sidebar: $("#sidebar"),
  btnEdit: $("#btn-edit"), btnSave: $("#btn-save"), btnCancel: $("#btn-cancel"),
  saveState: $("#save-state"),
};

const state = {
  current: null,     // caminho relativo da nota aberta
  raw: "",           // conteúdo atual (texto)
  editing: false,
  readOnly: false,
  index: new Map(),  // stem/caminho (minúsculo) -> caminho real, p/ wikilinks
  paths: new Set(),  // caminhos relativos existentes (sem .md, minúsculo)
};

marked.setOptions({ breaks: false, gfm: true });

/* ---------- carregar árvore ---------- */
async function boot() {
  try {
    const meta = await (await fetch("/api/meta")).json();
    state.readOnly = meta.read_only;
    el.vault.textContent = meta.vault || "vault";
    const { tree } = await (await fetch("/api/tree")).json();
    buildIndex(tree);
    el.tree.innerHTML = "";
    el.tree.appendChild(renderTree(tree));
    addMobileToggle();
  } catch (e) {
    el.tree.innerHTML = `<div style="color:var(--err);padding:10px">Erro ao carregar o vault.</div>`;
  }
}

function buildIndex(nodes) {
  for (const n of nodes) {
    if (n.type === "file") {
      const noExt = n.path.replace(/\.md$/i, "");
      state.paths.add(noExt.toLowerCase());
      // indexa por caminho completo e por nome-base
      state.index.set(noExt.toLowerCase(), n.path);
      const stem = n.name.toLowerCase();
      if (!state.index.has(stem)) state.index.set(stem, n.path);
    } else if (n.children) {
      buildIndex(n.children);
    }
  }
}

function renderTree(nodes) {
  const ul = document.createElement("ul");
  for (const n of nodes) {
    const li = document.createElement("li");
    if (n.type === "dir") {
      li.className = "dir";
      const row = nodeRow("▾", n.name, true);
      row.addEventListener("click", () => li.classList.toggle("collapsed"));
      li.appendChild(row);
      li.appendChild(renderTree(n.children));
    } else {
      const row = nodeRow("📄", n.name, false);
      row.dataset.path = n.path;
      row.addEventListener("click", () => openNote(n.path));
      li.appendChild(row);
    }
    ul.appendChild(li);
  }
  return ul;
}

function nodeRow(ico, name, isDir) {
  const d = document.createElement("div");
  d.className = "node";
  d.innerHTML = `<span class="ico">${ico}</span><span class="label"></span>`;
  d.querySelector(".label").textContent = name;
  return d;
}

/* ---------- abrir / renderizar ---------- */
async function openNote(path) {
  if (state.editing && !confirmDiscard()) return;
  try {
    const res = await fetch("/api/file?path=" + encodeURIComponent(path));
    if (!res.ok) throw new Error();
    state.raw = await res.text();
    state.current = path;
    state.editing = false;
    el.welcome.hidden = true;
    el.crumb.textContent = path;
    highlightActive(path);
    renderView();
    el.sidebar.classList.remove("open");
  } catch {
    el.view.innerHTML = `<p style="color:var(--err)">Não consegui abrir essa nota.</p>`;
  }
}

function renderView() {
  el.editor.hidden = true;
  el.view.hidden = false;
  el.view.innerHTML = marked.parse(preWikilinks(state.raw));
  postWikilinks();
  el.btnEdit.hidden = state.readOnly;
  el.btnSave.hidden = el.btnCancel.hidden = true;
  el.saveState.textContent = "";
  el.view.scrollTop = 0;
}

// [[alvo|alias]] / [[alvo]] / ![[alvo]]  ->  link markdown com esquema wikilink:
function preWikilinks(md) {
  return md.replace(/!?\[\[([^\]]+?)\]\]/g, (_, inner) => {
    const [target, alias] = inner.split("|");
    const label = (alias || target).trim();
    return `[${label}](wikilink:${encodeURIComponent(target.trim())})`;
  });
}

function postWikilinks() {
  el.view.querySelectorAll('a[href^="wikilink:"]').forEach((a) => {
    const target = decodeURIComponent(a.getAttribute("href").slice("wikilink:".length));
    const path = resolveNote(target);
    a.classList.add("wikilink");
    if (path) {
      a.addEventListener("click", (ev) => { ev.preventDefault(); openNote(path); });
    } else {
      a.classList.add("missing");
      a.title = "nota não encontrada: " + target;
      a.addEventListener("click", (ev) => ev.preventDefault());
    }
  });
}

function resolveNote(target) {
  // tira âncoras de heading (#) e de bloco (^)
  const clean = target.split(/[#^]/)[0].trim().toLowerCase();
  if (!clean) return null;
  if (state.index.has(clean)) return state.index.get(clean);
  // tenta como caminho relativo
  if (state.paths.has(clean)) return clean + ".md";
  return null;
}

/* ---------- editar / salvar ---------- */
function startEdit() {
  state.editing = true;
  el.view.hidden = true;
  el.editor.hidden = false;
  el.editor.value = state.raw;
  el.btnEdit.hidden = true;
  el.btnSave.hidden = el.btnCancel.hidden = false;
  el.saveState.textContent = "";
  el.editor.focus();
}

async function save() {
  if (!state.current) return;
  el.saveState.className = "save-state";
  el.saveState.textContent = "salvando…";
  try {
    const res = await fetch("/api/file?path=" + encodeURIComponent(state.current), {
      method: "PUT",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: el.editor.value,
    });
    if (!res.ok) throw new Error(await res.text());
    state.raw = el.editor.value;
    state.editing = false;
    renderView();
    el.saveState.className = "save-state ok";
    el.saveState.textContent = "✓ salvo";
    setTimeout(() => (el.saveState.textContent = ""), 2500);
  } catch (e) {
    el.saveState.className = "save-state err";
    el.saveState.textContent = "✗ erro ao salvar";
  }
}

function cancelEdit() {
  if (el.editor.value !== state.raw && !confirmDiscard()) return;
  state.editing = false;
  renderView();
}

function confirmDiscard() {
  return !state.editing || el.editor.value === state.raw ||
    confirm("Descartar alterações não salvas?");
}

/* ---------- auxiliares de UI ---------- */
function highlightActive(path) {
  el.tree.querySelectorAll(".node.active").forEach((n) => n.classList.remove("active"));
  const row = el.tree.querySelector(`.node[data-path="${CSS.escape(path)}"]`);
  if (row) row.classList.add("active");
}

function filterTree(q) {
  q = q.trim().toLowerCase();
  el.tree.querySelectorAll("li").forEach((li) => {
    const row = li.querySelector(":scope > .node");
    if (!row) return;
    if (li.parentElement && li.parentElement.closest("li.dir")) {} // noop
    const label = row.querySelector(".label").textContent.toLowerCase();
    const isDir = li.classList.contains("dir");
    if (isDir) {
      const anyChild = [...li.querySelectorAll("li:not(.dir) .label")]
        .some((l) => l.textContent.toLowerCase().includes(q));
      li.style.display = (q === "" || anyChild) ? "" : "none";
    } else {
      li.style.display = (q === "" || label.includes(q)) ? "" : "none";
    }
  });
}

function addMobileToggle() {
  if ($("#menu-btn")) return;
  const b = document.createElement("button");
  b.id = "menu-btn"; b.className = "btn"; b.textContent = "☰";
  b.style.cssText = "margin-right:4px";
  b.addEventListener("click", () => el.sidebar.classList.toggle("open"));
  const bar = $("#topbar");
  bar.insertBefore(b, bar.firstChild);
  const mq = window.matchMedia("(max-width:720px)");
  const sync = () => (b.style.display = mq.matches ? "" : "none");
  mq.addEventListener("change", sync); sync();
}

el.btnEdit.addEventListener("click", startEdit);
el.btnSave.addEventListener("click", save);
el.btnCancel.addEventListener("click", cancelEdit);
el.filter.addEventListener("input", (e) => filterTree(e.target.value));
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s" && state.editing) { e.preventDefault(); save(); }
  if ((e.ctrlKey || e.metaKey) && e.key === "e" && state.current && !state.readOnly) {
    e.preventDefault(); state.editing ? cancelEdit() : startEdit();
  }
});

boot();

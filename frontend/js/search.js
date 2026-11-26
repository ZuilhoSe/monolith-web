/* Índice em memória (NÃO toca no vault): resolução de wikilinks, busca de
   conteúdo full-text simples, quick-switcher fuzzy e backlinks on-the-fly. */
"use strict";

const WIKILINK_RE = /!?\[\[([^\]]+?)\]\]/g;

export function buildNoteIndex(tree) {
  const byStem = new Map();   // nome-base minúsculo -> path
  const byPath = new Map();   // path sem .md minúsculo -> path
  const flat = [];            // [{path, name}]
  (function walk(nodes) {
    for (const n of nodes) {
      if (n.type === "file") {
        flat.push({ path: n.path, name: n.name });
        byPath.set(n.path.replace(/\.md$/i, "").toLowerCase(), n.path);
        const stem = n.name.toLowerCase();
        if (!byStem.has(stem)) byStem.set(stem, n.path);
      } else if (n.children) walk(n.children);
    }
  })(tree);
  flat.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return { byStem, byPath, flat };
}

export function resolveNote(index, target) {
  const clean = String(target).split(/[#^]/)[0].trim().toLowerCase();
  if (!clean) return null;
  return index.byPath.get(clean) || index.byStem.get(clean) || null;
}

export class Indexer {
  constructor(index) { this.index = index; this.docs = new Map(); this.ready = false; }

  // Carrega o conteúdo de todas as notas e extrai links de saída (resolvidos).
  async build(adapter, onProgress) {
    const files = this.index.flat;
    let done = 0;
    for (const f of files) {
      let text = "";
      try { text = await adapter.readText(f.path); } catch { /* pula */ }
      const links = new Set();
      let m;
      WIKILINK_RE.lastIndex = 0;
      while ((m = WIKILINK_RE.exec(text))) {
        const p = resolveNote(this.index, m[1].split("|")[0]);
        if (p) links.add(p);
      }
      this.docs.set(f.path, { name: f.name, lower: text.toLowerCase(), links });
      if (onProgress && ++done % 25 === 0) onProgress(done, files.length);
    }
    this.ready = true;
    if (onProgress) onProgress(files.length, files.length);
  }

  // Busca de conteúdo: todos os termos presentes (AND), ranqueada.
  search(query, limit = 40) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    for (const [path, d] of this.docs) {
      let score = 0, ok = true;
      for (const t of terms) {
        const c = occurrences(d.lower, t);
        if (!c) { ok = false; break; }
        score += c;
      }
      if (!ok) continue;
      if (d.name.toLowerCase().includes(terms[0])) score += 10; // casar no título pesa mais
      out.push({ path, name: d.name, score, snippet: snippet(d.lower, terms[0]) });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
  }

  // Quick-switcher: fuzzy por nome/caminho.
  quickSwitch(query, limit = 20) {
    const q = query.toLowerCase().trim();
    const res = [];
    for (const f of this.index.flat) {
      const sc = fuzzyScore(q, f.name.toLowerCase(), f.path.toLowerCase());
      if (sc > -Infinity) res.push({ ...f, score: sc });
    }
    res.sort((a, b) => b.score - a.score);
    return res.slice(0, limit);
  }

  backlinks(path) {
    const out = [];
    for (const [p, d] of this.docs) if (p !== path && d.links.has(path)) out.push({ path: p, name: d.name });
    out.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return out;
  }
}

function occurrences(hay, needle) {
  let i = 0, c = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { c++; i += needle.length; }
  return c;
}

function snippet(lower, term) {
  const i = lower.indexOf(term);
  if (i < 0) return "";
  const start = Math.max(0, i - 30), end = Math.min(lower.length, i + term.length + 40);
  return (start ? "…" : "") + lower.slice(start, end).trim() + (end < lower.length ? "…" : "");
}

// Subsequence fuzzy: casa todos os chars de q em ordem; bônus por contiguidade/início.
function fuzzyScore(q, name, path) {
  if (!q) return 0;
  const hay = name + " " + path;
  let qi = 0, score = 0, streak = 0, lastIdx = -1;
  for (let i = 0; i < hay.length && qi < q.length; i++) {
    if (hay[i] === q[qi]) {
      score += 1 + (i === lastIdx + 1 ? streak * 2 : 0);
      if (i < name.length) score += 1;
      streak = i === lastIdx + 1 ? streak + 1 : 1;
      lastIdx = i; qi++;
    }
  }
  return qi === q.length ? score : -Infinity;
}

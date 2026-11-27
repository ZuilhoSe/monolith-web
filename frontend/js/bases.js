/* Bases: read-only rendering of Obsidian `.base` files (table views).
   Supported: global + per-view filters (and / or / not), formulas, property
   displayName, view order / sort / limit. Expressions: literals, note./file./
   formula. properties, + - * / %, comparisons, && || !, if(), and the
   functions/methods listed in CALLS / METHODS below.
   Nothing is ever written: the data comes from the in-memory index.
   Depends on the global `jsyaml` (vendor/js-yaml.min.js). */
"use strict";

/* ---------------- expression parser (Pratt) ---------------- */

function tokenize(src) {
  const out = []; let i = 0;
  const two = ["==", "!=", ">=", "<=", "&&", "||"];
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1]))) {
      const m = src.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i);
      out.push({ t: "num", v: parseFloat(m[0]) }); i += m[0].length; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, s = "";
      while (j < src.length && src[j] !== c) { if (src[j] === "\\") j++; s += src[j++]; }
      out.push({ t: "str", v: s }); i = j + 1; continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_$][\w$]*/);
      out.push({ t: "id", v: m[0] }); i += m[0].length; continue;
    }
    const op = two.find((o) => src.startsWith(o, i));
    if (op) { out.push({ t: "op", v: op }); i += 2; continue; }
    if ("+-*/%<>!().,[]".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  out.push({ t: "eof" });
  return out;
}

const BP = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4,
             "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

export function parseExpr(src) {
  const toks = tokenize(String(src)); let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const expect = (v) => { const t = next(); if (t.v !== v) throw new Error(`Expected "${v}"`); };

  function primary() {
    const t = next();
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "id") {
      if (t.v === "true" || t.v === "false") return { k: "lit", v: t.v === "true" };
      if (t.v === "null") return { k: "lit", v: null };
      return { k: "id", v: t.v };
    }
    if (t.v === "(") { const e = expr(0); expect(")"); return e; }
    if (t.v === "[") {
      const items = [];
      if (peek().v !== "]") { do { items.push(expr(0)); } while (peek().v === "," && next()); }
      expect("]"); return { k: "list", items };
    }
    if (t.v === "!" ) return { k: "not", e: unary() };
    if (t.v === "-") return { k: "neg", e: unary() };
    throw new Error("Unexpected end of expression");
  }
  function postfix(e) {
    for (;;) {
      if (peek().v === ".") { next(); const n = next(); if (n.t !== "id") throw new Error("Expected name"); e = { k: "get", obj: e, name: n.v }; }
      else if (peek().v === "(") {
        next(); const args = [];
        if (peek().v !== ")") { do { args.push(expr(0)); } while (peek().v === "," && next()); }
        expect(")"); e = { k: "call", fn: e, args };
      } else return e;
    }
  }
  function unary() { return postfix(primary()); }
  function expr(min) {
    let left = unary();
    for (;;) {
      const t = peek();
      const bp = t.t === "op" ? BP[t.v] : undefined;
      if (bp === undefined || bp <= min) return left;
      next();
      left = { k: "bin", op: t.v, a: left, b: expr(bp) };
    }
  }
  const e = expr(0);
  if (peek().t !== "eof") throw new Error(`Unexpected "${peek().v}"`);
  return e;
}

/* ---------------- evaluation ---------------- */

const num = (v) => (typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v));
function loose(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (typeof a === "number" || typeof b === "number") return num(a) === num(b);
  return String(a) === String(b);
}
const linkTarget = (s) => String(s).replace(/^\[\[|\]\]$/g, "").split("|")[0].trim().toLowerCase();

const METHODS = {
  contains: (v, x) => Array.isArray(v) ? v.some((y) => loose(y, x) || linkTarget(y) === linkTarget(x))
                                       : String(v ?? "").toLowerCase().includes(String(x).toLowerCase()),
  containsAny: (v, ...xs) => xs.some((x) => METHODS.contains(v, x)),
  containsAll: (v, ...xs) => xs.every((x) => METHODS.contains(v, x)),
  startsWith: (v, x) => String(v ?? "").startsWith(x),
  endsWith: (v, x) => String(v ?? "").endsWith(x),
  isEmpty: (v) => v == null || v === "" || (Array.isArray(v) && !v.length),
  toFixed: (v, n) => (Number.isFinite(num(v)) ? num(v).toFixed(n ?? 0) : null),
  lower: (v) => String(v ?? "").toLowerCase(),
  upper: (v) => String(v ?? "").toUpperCase(),
  join: (v, sep = ", ") => (Array.isArray(v) ? v.join(sep) : v),
  round: (v, n = 0) => Math.round(num(v) * 10 ** n) / 10 ** n,
  abs: (v) => Math.abs(num(v)),
};
const GLOBALS = {
  if: (c, a, b = null) => (truthy(c) ? a : b),
  number: (v) => num(v),
  min: (...a) => Math.min(...a.map(num)),
  max: (...a) => Math.max(...a.map(num)),
  list: (v) => (Array.isArray(v) ? v : v == null ? [] : [v]),
};
const truthy = (v) => !(v == null || v === false || v === 0 || v === "" || Number.isNaN(v) || (Array.isArray(v) && !v.length));

function evalNode(n, row) {
  switch (n.k) {
    case "lit": return n.v;
    case "list": return n.items.map((x) => evalNode(x, row));
    case "not": return !truthy(evalNode(n.e, row));
    case "neg": return -num(evalNode(n.e, row));
    case "id":
      if (n.v === "note" || n.v === "file" || n.v === "formula") return { __ns: n.v };
      return row.note[n.v];                          // bare name = note property
    case "get": {
      if (n.obj.k === "id" && ["note", "file", "formula"].includes(n.obj.v)) return row.get(n.obj.v, n.name);
      const o = evalNode(n.obj, row);
      if (n.name === "length") return Array.isArray(o) || typeof o === "string" ? o.length : null;
      return { __method: n.name, self: o };
    }
    case "call": {
      if (n.fn.k === "id") {
        const g = GLOBALS[n.fn.v];
        if (!g) throw new Error(`Unknown function ${n.fn.v}()`);
        return g(...n.args.map((a) => evalNode(a, row)));
      }
      if (n.fn.k === "get" && n.fn.obj.k === "id" && n.fn.obj.v === "file") {
        const f = row.fileFns[n.fn.name];
        if (!f) throw new Error(`Unsupported file.${n.fn.name}()`);
        return f(...n.args.map((a) => evalNode(a, row)));
      }
      if (n.fn.k === "get") {
        const self = evalNode(n.fn.obj, row), m = METHODS[n.fn.name];
        if (!m) throw new Error(`Unsupported method .${n.fn.name}()`);
        return m(self, ...n.args.map((a) => evalNode(a, row)));
      }
      throw new Error("Unsupported call");
    }
    case "bin": {
      if (n.op === "&&") return truthy(evalNode(n.a, row)) && truthy(evalNode(n.b, row));
      if (n.op === "||") return truthy(evalNode(n.a, row)) || truthy(evalNode(n.b, row));
      const a = evalNode(n.a, row), b = evalNode(n.b, row);
      switch (n.op) {
        case "==": return loose(a, b);
        case "!=": return !loose(a, b);
        case "+": return typeof a === "string" || typeof b === "string" ? `${a ?? ""}${b ?? ""}` : num(a) + num(b);
        case "-": return num(a) - num(b);
        case "*": return num(a) * num(b);
        case "/": return num(a) / num(b);
        case "%": return num(a) % num(b);
      }
      if (a == null || b == null) return false;      // missing values never pass < > <= >=
      const [x, y] = Number.isFinite(num(a)) && Number.isFinite(num(b)) ? [num(a), num(b)] : [String(a), String(b)];
      return n.op === "<" ? x < y : n.op === ">" ? x > y : n.op === "<=" ? x <= y : x >= y;
    }
  }
  throw new Error("Bad expression");
}

/* ---------------- rows ---------------- */

function makeRow(doc, formulas, cache) {
  const note = doc.props || {};
  const folder = doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/")) : "";
  const file = {
    name: doc.path.split("/").pop().replace(/\.md$/i, ""), basename: doc.name, path: doc.path,
    folder, ext: "md", tags: doc.tags || [], links: [...(doc.links || [])],
  };
  const row = {
    doc, note, file,
    fileFns: {
      inFolder: (f) => { f = String(f).replace(/^\/|\/$/g, ""); return !f || doc.path === f || doc.path.startsWith(f + "/"); },
      hasTag: (...tags) => tags.some((t) => file.tags.some((x) => {
        x = x.toLowerCase(); t = String(t).replace(/^#/, "").toLowerCase();
        return x === t || x.startsWith(t + "/");
      })),
      hasLink: (t) => file.links.some((l) => linkTarget(l).endsWith(linkTarget(t))),
      hasProperty: (p) => Object.prototype.hasOwnProperty.call(note, p),
    },
    get(ns, name) {
      if (ns === "note") return note[name];
      if (ns === "file") return file[name];
      if (!(name in cache)) {
        if (!formulas[name]) throw new Error(`Unknown formula ${name}`);
        cache[name] = undefined;                       // cycle guard
        cache[name] = evalNode(formulas[name], row);
      }
      return cache[name];
    },
  };
  return row;
}

function evalFilter(f, row) {
  if (f == null) return true;
  if (typeof f === "string") return truthy(evalNode(parseCached(f), row));
  if (Array.isArray(f)) return f.every((x) => evalFilter(x, row));
  if (f.and) return f.and.every((x) => evalFilter(x, row));
  if (f.or) return f.or.some((x) => evalFilter(x, row));
  if (f.not) return !(Array.isArray(f.not) ? f.not : [f.not]).some((x) => evalFilter(x, row));
  return true;
}
const _parsed = new Map();
function parseCached(s) { if (!_parsed.has(s)) _parsed.set(s, parseExpr(s)); return _parsed.get(s); }

function colValue(id, row) {
  const m = String(id).match(/^(note|file|formula)\.(.+)$/);
  return m ? row.get(m[1], m[2]) : row.get("note", id);
}

/* ---------------- rendering ---------------- */

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function cellHTML(v) {
  if (v == null || (typeof v === "number" && Number.isNaN(v))) return "";
  if (Array.isArray(v)) return v.map(cellHTML).join('<span class="base-sep">, </span>');
  if (typeof v === "boolean") return v ? '<span class="base-true">✓</span>' : '<span class="base-false">—</span>';
  if (typeof v === "number") return esc(Number.isInteger(v) ? v : +v.toFixed(4));
  const s = String(v);
  if (/\[\[[^\]]+\]\]/.test(s))
    return esc(s).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, a) => `<a class="wikilink" data-note="${t.trim()}">${(a || t).trim()}</a>`);
  if (/^https?:\/\//.test(s)) return `<a href="${esc(s)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40))}</a>`;
  return esc(s);
}

function defaultLabel(id) {
  const m = String(id).match(/^(?:note|file|formula)\.(.+)$/);
  const k = m ? m[1] : id;
  return id === "file.name" ? "Name" : k.replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/* Renders a base into `host`.
   base text  : raw YAML of the .base file
   docs       : Map(path -> {name, path, props, tags, links})
   ctx        : { onNavigate(target), viewName? } */
export function renderBase(host, text, docs, ctx) {
  host.classList.add("base-host");
  let base;
  try { base = window.jsyaml.load(text) || {}; }
  catch (e) { host.innerHTML = `<div class="base-error">Invalid .base file: ${esc(e.message)}</div>`; return; }

  const views = Array.isArray(base.views) && base.views.length ? base.views : [{ type: "table", name: "Table" }];
  let active = Math.max(0, views.findIndex((v) => v.name === ctx.viewName));

  const draw = () => {
    const view = views[active];
    const tabs = views.length > 1
      ? `<div class="base-tabs">${views.map((v, i) => `<button class="base-tab${i === active ? " active" : ""}" data-i="${i}">${esc(v.name || "View " + (i + 1))}</button>`).join("")}</div>`
      : `<div class="base-tabs"><span class="base-tab active">${esc(view.name || "Table")}</span></div>`;
    let body;
    try { body = viewHTML(base, view, docs); }
    catch (e) { body = `<div class="base-error">Can't evaluate this view: ${esc(e.message)}</div>`; }
    host.innerHTML = tabs + body;
    host.querySelectorAll(".base-tab[data-i]").forEach((b) =>
      b.addEventListener("click", () => { active = +b.dataset.i; draw(); }));
    host.querySelectorAll("a.wikilink[data-note], a.base-file[data-path]").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); ctx.onNavigate(a.dataset.path || a.dataset.note); }));
  };
  draw();
}

function viewHTML(base, view, docs) {
  if ((view.type || "table") !== "table")
    return `<div class="base-note">The “${esc(view.type)}” view isn't supported in Monolith yet. Open it in Obsidian, or switch to a table view.</div>`;
  const formulas = {};
  for (const [k, src] of Object.entries(base.formulas || {})) formulas[k] = parseExpr(src);

  let rows = [];
  for (const doc of docs.values()) {
    const row = makeRow(doc, formulas, {});
    if (evalFilter(base.filters, row) && evalFilter(view.filters, row)) rows.push(row);
  }
  const sorts = Array.isArray(view.sort) ? view.sort : [];
  rows.sort((a, b) => {
    for (const s of sorts) {
      const x = colValue(s.property, a), y = colValue(s.property, b);
      const d = Number.isFinite(num(x)) && Number.isFinite(num(y)) ? num(x) - num(y)
              : String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true });
      if (d) return String(s.direction).toUpperCase() === "DESC" ? -d : d;
    }
    return a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
  });
  const total = rows.length;
  if (view.limit) rows = rows.slice(0, view.limit);

  const cols = Array.isArray(view.order) && view.order.length ? view.order : ["file.name"];
  const props = base.properties || {};
  const label = (id) => props[id]?.displayName || props[id.replace(/^note\./, "")]?.displayName || defaultLabel(id);

  const head = cols.map((c) => `<th>${esc(label(c))}</th>`).join("");
  const body = rows.map((r) => "<tr>" + cols.map((c) => {
    if (c === "file.name") return `<td><a class="base-file" data-path="${esc(r.doc.path)}">${esc(r.file.name)}</a></td>`;
    let v; try { v = colValue(c, r); } catch (e) { v = "⚠ " + e.message; }
    return `<td>${cellHTML(v)}</td>`;
  }).join("") + "</tr>").join("");
  const note = view.groupBy ? `<span class="base-note-inline">· grouping isn't supported yet, shown ungrouped</span>` : "";
  return `<div class="base-count">${total} result${total === 1 ? "" : "s"}${view.limit && total > view.limit ? ` · showing ${view.limit}` : ""} ${note}</div>
    <div class="base-scroll"><table class="base-table"><thead><tr>${head}</tr></thead><tbody>${body ||
    `<tr><td class="base-empty" colspan="${cols.length}">No notes match this view.</td></tr>`}</tbody></table></div>`;
}

/* ---------------- frontmatter ---------------- */

export function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { props: null, body: text, yaml: "" };
  let props = null;
  try { const p = window.jsyaml.load(m[1]); if (p && typeof p === "object" && !Array.isArray(p)) props = p; } catch { /* invalid YAML: keep raw */ }
  return { props, body: text.slice(m[0].length), yaml: m[1] };
}

export function propertiesHTML(props) {
  const rows = Object.entries(props).map(([k, v]) =>
    `<div class="prop-row"><span class="prop-key">${esc(k)}</span><span class="prop-val">${cellHTML(v) || '<span class="prop-empty">Empty</span>'}</span></div>`).join("");
  return `<div class="properties"><div class="properties-title">Properties</div>${rows}</div>`;
}

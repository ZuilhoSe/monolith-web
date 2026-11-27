/* Render pipeline: Markdown (GFM) + wikilinks + image embeds +
   math (KaTeX) + Mermaid + callouts + clickable tasks.
   Depends on globals: marked, katex (vendor/*). Mermaid is optional. */
"use strict";

const IMG_EXT = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;
const CALLOUT_ICON = {
  note: "📝", info: "ℹ️", tip: "💡", important: "❗", warning: "⚠️",
  caution: "🔥", danger: "🚫", success: "✅", question: "❓", quote: "❝",
  abstract: "📑", example: "🧪", bug: "🐞", todo: "☑️", failure: "✗",
};

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function katexHTML(expr, display) {
  try {
    return window.katex.renderToString(expr, { displayMode: display, throwOnError: false, output: "html" });
  } catch {
    return '<code class="katex-error">' + esc(expr) + "</code>";
  }
}

/* Converts raw Markdown to HTML, protecting code/math and handling Obsidian's
   syntax. Returns an HTML string (with data-* attributes for async steps). */
export function toHTML(raw) {
  const store = [];
  const tok = (html) => { store.push(html); return `<!--OW${store.length - 1}-->`; };
  let s = raw;

  // 1. fenced code blocks (``` ```), including mermaid
  s = s.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    lang = (lang || "").trim().toLowerCase();
    if (lang === "mermaid") return tok(`<div class="mermaid">${esc(code.trimEnd())}</div>`);
    const cls = lang ? ` class="language-${esc(lang)}"` : "";
    return tok(`<pre><code${cls}>${esc(code.replace(/\n$/, ""))}</code></pre>`);
  });
  // 2. inline code (`...`)
  s = s.replace(/`([^`\n]+?)`/g, (_, c) => tok(`<code>${esc(c)}</code>`));
  // 3. block math $$...$$ and inline $...$
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, e) => tok(katexHTML(e.trim(), true)));
  s = s.replace(/(^|[^\\$])\$([^\$\n]+?)\$/g, (m, pre, e) => pre + tok(katexHTML(e.trim(), false)));
  // 4. embeds and wikilinks
  s = s.replace(/!\[\[([^\]]+?)\]\]/g, (_, inner) => {
    const target = inner.split("|")[0].trim();
    if (IMG_EXT.test(target)) return tok(`<img class="embed" data-vault-src="${esc(target)}" alt="${esc(target)}">`);
    return tok(`<a class="wikilink embed-note" data-note="${esc(target)}">📄 ${esc(target.replace(/\.md$/i, ""))}</a>`);
  });
  s = s.replace(/\[\[([^\]]+?)\]\]/g, (_, inner) => {
    const [target, alias] = inner.split("|");
    const label = (alias || target).trim();
    return tok(`<a class="wikilink" data-note="${esc(target.trim())}">${esc(label)}</a>`);
  });

  let html = window.marked.parse(s, { gfm: true, breaks: false });
  // restore the protected tokens
  html = html.replace(/<!--OW(\d+)-->/g, (_, i) => store[+i]);
  return html;
}

/* Mounts the HTML into the container and runs the async/interactive steps. */
export async function mountInto(container, raw, ctx) {
  container.innerHTML = toHTML(raw);
  transformCallouts(container);
  wireWikilinks(container, ctx);
  await resolveImages(container, ctx);
  wireTasks(container, raw, ctx);
  await runMermaid(container);
}

function transformCallouts(root) {
  root.querySelectorAll("blockquote").forEach((bq) => {
    const html = bq.innerHTML;
    const m = html.match(/^\s*<p>\s*\[!(\w+)\][+-]?\s*([^\n<]*)/i);
    if (!m) return;
    const type = m[1].toLowerCase();
    const title = m[2].trim() || type.charAt(0).toUpperCase() + type.slice(1);
    const icon = CALLOUT_ICON[type] || "📌";
    // strip only the "[!type] title" line (up to the first break); the rest is the body
    let body = html.replace(/^\s*<p>\s*\[!\w+\][+-]?\s*[^\n<]*(?:\n|<br\s*\/?>)?/i, "<p>")
                   .replace(/^<p>\s*<\/p>\s*/i, "");
    const div = document.createElement("div");
    div.className = "callout callout-" + type;
    div.innerHTML = `<div class="callout-title"><span class="callout-icon">${icon}</span>${esc(title)}</div><div class="callout-body">${body}</div>`;
    bq.replaceWith(div);
  });
}

function wireWikilinks(root, ctx) {
  root.querySelectorAll("a.wikilink[data-note]").forEach((a) => {
    const target = a.getAttribute("data-note");
    const path = ctx.resolveNote(target);
    if (path) {
      a.addEventListener("click", (e) => { e.preventDefault(); ctx.onNavigate(path); });
    } else {
      a.classList.add("missing");
      a.title = "note not found: " + target;
      a.addEventListener("click", (e) => e.preventDefault());
    }
  });
}

async function resolveImages(root, ctx) {
  const imgs = [...root.querySelectorAll("img[data-vault-src]")];
  // standard images ![](path) that aren't http/data/blob also resolve from the vault
  root.querySelectorAll("img:not([data-vault-src])").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!/^(https?:|data:|blob:)/.test(src)) { img.setAttribute("data-vault-src", decodeURIComponent(src)); imgs.push(img); }
  });
  for (const img of imgs) {
    const p = ctx.resolvePath(img.getAttribute("data-vault-src"));
    if (!p) { img.replaceWith(Object.assign(document.createElement("span"), { className: "img-missing", textContent: "🖼️ " + img.alt })); continue; }
    try { img.src = await ctx.adapter.fileURL(p); } catch { /* ignore */ }
  }
}

function wireTasks(root, raw, ctx) {
  const boxes = [...root.querySelectorAll('li input[type="checkbox"]')];
  const lines = raw.split("\n");
  // map each checkbox, in order, to the index of its task line
  const taskLines = [];
  lines.forEach((ln, i) => { if (/^\s*[-*+]\s+\[[ xX]\]/.test(ln)) taskLines.push(i); });
  boxes.forEach((box, k) => {
    box.disabled = ctx.readOnly;
    if (ctx.readOnly) return;
    box.addEventListener("change", () => {
      const li = taskLines[k]; if (li == null) return;
      lines[li] = lines[li].replace(/\[[ xX]\]/, box.checked ? "[x]" : "[ ]");
      ctx.onToggleTask(lines.join("\n"));
    });
  });
}

let _mermaidInit = false;
async function runMermaid(root) {
  const nodes = root.querySelectorAll(".mermaid");
  if (!nodes.length || !window.mermaid) return;
  if (!_mermaidInit) {
    window.mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
    _mermaidInit = true;
  }
  try { await window.mermaid.run({ nodes }); } catch { /* leave the raw code visible */ }
}

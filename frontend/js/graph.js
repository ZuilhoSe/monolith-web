/* Graph view: force-directed graph of notes (nodes) and wikilinks (edges)
   on a canvas. Pan (drag), zoom (wheel), click a node to open the note.
   No dependencies. */
"use strict";

export function renderGraph(container, nodes, edges, onOpen) {
  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.className = "graph-canvas";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");

  const css = getComputedStyle(document.documentElement);
  const COL_NODE = css.getPropertyValue("--acc").trim() || "#a78bfa";
  const COL_EDGE = css.getPropertyValue("--line").trim() || "#383838";
  const COL_TXT = css.getPropertyValue("--mut").trim() || "#9a9a9a";
  const COL_HI = "#ffffff";

  let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    const r = container.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
  }
  resize();
  const ro = new ResizeObserver(resize); ro.observe(container);

  // view transform
  let scale = 1, ox = W / 2, oy = H / 2;
  // starts centred on the nodes (which spawn near 0,0)
  let hover = -1, dragging = false, dragModel = null, lastX = 0, lastY = 0, moved = 0;

  function sim() {
    const K = 0.015, REP = 1600, SPRING = 0.02, LEN = 60, DAMP = 0.86;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      a.vx += -a.x * K; a.vy += -a.y * K;         // centring force
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || 0.01;
        const f = REP / d2, d = Math.sqrt(d2);
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
    }
    for (const [i, j] of edges) {               // springs along edges
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01;
      const f = (d - LEN) * SPRING, fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
    for (const n of nodes) {
      if (n === dragModel) continue;
      n.vx *= DAMP; n.vy *= DAMP; n.x += n.vx; n.y += n.vy;
    }
  }

  function draw() {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(ox, oy); ctx.scale(scale, scale);
    // edges
    ctx.strokeStyle = COL_EDGE; ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    for (const [i, j] of edges) { ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y); }
    ctx.stroke();
    // nodes
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], r = 3 + Math.min(n.deg, 8) * 1.1;
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 6.2832);
      ctx.fillStyle = i === hover ? COL_HI : COL_NODE; ctx.fill();
    }
    // labels (when zoomed in enough, or on hover)
    ctx.fillStyle = COL_TXT; ctx.font = (11 / scale) + "px sans-serif"; ctx.textAlign = "center";
    if (scale > 0.7 || hover >= 0) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]; if (scale <= 0.7 && i !== hover) continue;
        ctx.fillStyle = i === hover ? COL_HI : COL_TXT;
        ctx.fillText(n.name, n.x, n.y + 4 + Math.min(n.deg, 8) * 1.1 + 10 / scale);
      }
    }
    ctx.restore();
  }

  let raf;
  function loop() {
    if (!canvas.isConnected) { ro.disconnect(); return; } // stop once the view is gone
    sim(); draw(); raf = requestAnimationFrame(loop);
  }
  loop();

  // interaction
  function toModel(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left - ox) / scale, y: (ev.clientY - r.top - oy) / scale, sx: ev.clientX - r.left, sy: ev.clientY - r.top };
  }
  function pick(mx, my) {
    let best = -1, bd = 14 / scale;
    for (let i = 0; i < nodes.length; i++) {
      const d = Math.hypot(nodes[i].x - mx, nodes[i].y - my);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  canvas.addEventListener("mousedown", (e) => { dragging = true; moved = 0; const m = toModel(e); lastX = m.sx; lastY = m.sy; const p = pick(m.x, m.y); dragModel = p >= 0 ? nodes[p] : null; });
  window.addEventListener("mousemove", (e) => {
    const m = toModel(e); hover = pick(m.x, m.y);
    canvas.style.cursor = hover >= 0 ? "pointer" : (dragging ? "grabbing" : "grab");
    if (!dragging) return;
    const dx = m.sx - lastX, dy = m.sy - lastY; moved += Math.abs(dx) + Math.abs(dy);
    if (dragModel) { dragModel.x += dx / scale; dragModel.y += dy / scale; dragModel.vx = dragModel.vy = 0; }
    else { ox += dx; oy += dy; }
    lastX = m.sx; lastY = m.sy;
  });
  window.addEventListener("mouseup", (e) => {
    if (dragging && moved < 4) { const m = toModel(e); const p = pick(m.x, m.y); if (p >= 0) onOpen(nodes[p].id); }
    dragging = false; dragModel = null;
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.001);
    ox = mx - (mx - ox) * f; oy = my - (my - oy) * f; scale *= f;
    scale = Math.max(0.15, Math.min(4, scale));
  }, { passive: false });
}

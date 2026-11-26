"""
Obsidian Web — backend (modo servidor).

Cliente web self-hosted, open-source e NÃO-INVASIVO para um vault do Obsidian:
lê/escreve os .md como estão, nunca grava índice/meta dentro do vault, e delega
a autenticação ao reverse proxy. Também serve o frontend, que funciona tanto
neste modo servidor quanto em modo local (pasta no navegador, sem backend).

Env:
  VAULT_DIR   caminho do vault no container (padrão: /vault)
  READ_ONLY   "true" desliga a escrita (padrão: false)
"""
import mimetypes
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Body, Query
from fastapi.responses import PlainTextResponse, FileResponse
from fastapi.staticfiles import StaticFiles

VAULT = Path(os.environ.get("VAULT_DIR", "/vault")).resolve()
READ_ONLY = os.environ.get("READ_ONLY", "false").lower() in ("1", "true", "yes")
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
HIDDEN_PREFIXES = (".",)

app = FastAPI(title="Obsidian Web", version="0.2.0")


@app.middleware("http")
async def no_cache(request, call_next):
    """Evita que proxies/CDN (ex.: Cloudflare) sirvam assets estáticos velhos
    depois de um deploy. 'no-cache' força revalidação por ETag a cada carga."""
    resp = await call_next(request)
    if not request.url.path.startswith("/api"):
        resp.headers["Cache-Control"] = "no-cache"
    return resp


def _safe(rel: str) -> Path:
    rel = (rel or "").lstrip("/")
    p = (VAULT / rel).resolve()
    if p != VAULT and VAULT not in p.parents:
        raise HTTPException(status_code=400, detail="caminho fora do vault")
    return p


def _hidden(name: str) -> bool:
    return name.startswith(HIDDEN_PREFIXES)


def _tree(folder: Path) -> list:
    items = []
    try:
        entries = sorted(folder.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
    except (PermissionError, FileNotFoundError):
        return items
    for e in entries:
        if _hidden(e.name):
            continue
        rel = str(e.relative_to(VAULT))
        if e.is_dir():
            children = _tree(e)
            if children:
                items.append({"type": "dir", "name": e.name, "path": rel, "children": children})
        elif e.suffix.lower() == ".md":
            items.append({"type": "file", "name": e.stem, "path": rel})
    return items


@app.get("/api/meta")
def meta():
    return {"vault": VAULT.name, "read_only": READ_ONLY}


@app.get("/api/tree")
def tree():
    if not VAULT.is_dir():
        raise HTTPException(status_code=500, detail=f"vault não encontrado: {VAULT}")
    return {"tree": _tree(VAULT)}


@app.get("/api/files")
def all_files():
    """Todos os arquivos do vault (inclui imagens/anexos) p/ resolver embeds por nome."""
    out = []
    if VAULT.is_dir():
        for p in VAULT.rglob("*"):
            if p.is_file() and not any(part.startswith(".") for part in p.relative_to(VAULT).parts):
                out.append(str(p.relative_to(VAULT)))
    return {"files": out}


@app.get("/api/file", response_class=PlainTextResponse)
def read_file(path: str = Query(...)):
    p = _safe(path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="nota não encontrada")
    return p.read_text(encoding="utf-8")


@app.get("/api/raw")
def read_raw(path: str = Query(...)):
    """Bytes crus de qualquer arquivo do vault (imagens, anexos, embeds)."""
    p = _safe(path)
    if not p.is_file():
        raise HTTPException(status_code=404, detail="arquivo não encontrado")
    ctype, _ = mimetypes.guess_type(str(p))
    return FileResponse(str(p), media_type=ctype or "application/octet-stream")


@app.put("/api/file")
def write_file(path: str = Query(...), body: str = Body(..., media_type="text/plain")):
    if READ_ONLY:
        raise HTTPException(status_code=403, detail="modo somente-leitura")
    p = _safe(path)
    if p.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="só .md")
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(body, encoding="utf-8")
    os.replace(tmp, p)
    return {"ok": True, "path": path, "bytes": len(body.encode("utf-8"))}


app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="frontend")

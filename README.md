# Obsidian Web

Cliente web **open-source** e **não-invasivo** para um vault do
[Obsidian](https://obsidian.md). Lê e escreve seus arquivos `.md` **como estão** —
nunca grava índice, cache ou metadados dentro do vault.

Funciona de **dois modos**, com a mesma interface:

- **Local** — escolhe uma pasta no navegador via *File System Access API*. **Sem
  servidor, sem backend**: os arquivos nunca saem do seu computador. (Chrome/Edge)
- **Servidor** — um backend FastAPI serve o vault de uma máquina remota, com a
  autenticação delegada ao reverse proxy (ex.: Cloudflare Access). Acessível de
  qualquer navegador, de qualquer lugar.

## Funcionalidades (v0.2)

- Navegar a árvore do vault (ignora `.obsidian`, `.trash`, etc.).
- Render rico: **`[[wikilinks]]`** clicáveis, **math (KaTeX)**, **Mermaid**,
  **callouts** (`> [!tip]`), **imagens/embeds** (`![[img.png]]`) e **tarefas**
  clicáveis que salvam no arquivo.
- **Backlinks** ("linked mentions") computados on-the-fly.
- **Busca de conteúdo** full-text + **Quick Switcher** (`Ctrl/Cmd+O`).
- Editar e salvar (escrita atômica). `Ctrl/Cmd+E` edita, `Ctrl/Cmd+S` salva.

Tudo em **JS puro, sem passo de build**. O índice de busca vive **em memória**,
nunca é escrito no vault.

## Rodar

**Modo local:** sirva a pasta `frontend/` em qualquer host estático (ou GitHub
Pages) e abra no Chrome/Edge → "Abrir pasta do vault".

**Modo servidor:**
```bash
docker compose up -d --build
curl -I http://127.0.0.1:8099/
```
Ajuste o caminho do vault no `compose.yml`. Para acesso remoto, aponte o
túnel/reverse proxy para `obsidian-web:8000` e proteja o subdomínio.

## Roadmap (v0.3+)

- [ ] Graph view (local + global)
- [ ] Tags (`#tag`) navegáveis
- [ ] Editor com live-preview (CodeMirror 6)
- [ ] Transclusão de notas (`![[nota]]` embutida)
- [ ] Frontmatter/propriedades
- [ ] Command palette, daily notes, temas, PWA/offline

## Arquitetura

- `backend/app.py` — FastAPI: árvore, leitura/escrita de `.md`, bytes crus (imagens).
- `frontend/js/vault.js` — adapters `ServerAdapter` e `LocalAdapter` (mesma interface).
- `frontend/js/render.js` — pipeline Markdown → HTML rico.
- `frontend/js/search.js` — índice em memória: resolução de links, busca, backlinks.
- `frontend/js/app.js` — glue/UI.

## Licença

MIT.

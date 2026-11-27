# Contributing to Monolith

Thanks for helping! This project is small on purpose and easy to get into.

## Run it locally

No build step. Pick one:

```bash
# Local mode only (static)
cd frontend && python3 -m http.server 8000

# Server mode (with the demo vault)
pip install -r backend/requirements.txt
VAULT_DIR=examples/demo-vault uvicorn backend.app:app --reload --port 8000
```

Open <http://localhost:8000>, edit a file in `frontend/`, refresh.

## Ground rules

1. **Never write to the vault except the note the user is saving.** No index files, caches,
   hidden folders, or rewrites of frontmatter the user didn't touch. Settings Obsidian keeps in
   `.obsidian/` may be *read*, never written.
2. **Match Obsidian.** When in doubt, do what Obsidian does, and put a Markdown snippet in the
   demo vault that shows it.
3. **No build step, no framework.** Plain ES modules. New dependencies go in `frontend/vendor/`
   so everything keeps working offline.
4. **Both modes.** Anything that touches files must go through the adapter interface in
   `js/vault.js` so it works in local *and* server mode.

## Good first contributions

- Rendering differences from Obsidian (with a test note in `examples/demo-vault/`)
- One of the *"coming soon"* buttons — see the Roadmap in the README
- Accessibility and keyboard navigation
- Translations of the UI

## Pull requests

Keep them focused, describe what you tested (which mode, which browser), and add a screenshot
for UI changes.

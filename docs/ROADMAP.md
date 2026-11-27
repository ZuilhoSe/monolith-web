# Roadmap: Obsidian plugin & theme compatibility

**Goal:** run the Obsidian *ecosystem* (community themes, CSS snippets and plugins) in the browser,
without running Obsidian's proprietary app, and without breaking Monolith's rule of never writing
into your vault.

> Status: **planned**. Nothing here is implemented yet. Discussion and help are very welcome. Open an
> issue or comment on the tracking issue before starting a phase so work isn't duplicated.

## Why this approach

There are two ways to get "real Obsidian" in a browser:

| | A. Run Obsidian's own code in the browser | **B. Re-implement Obsidian's public API (this plan)** |
|---|---|---|
| How | Load the desktop app's JavaScript in a page and shim the Electron/Node APIs it calls | Implement the documented plugin API on top of Monolith's own engine |
| Plugins | All, via the real app | Those that use the documented API (tracked in a compatibility list) |
| License | Depends on proprietary code; Obsidian's [terms](https://obsidian.md/terms) prohibit modifying the software, derivative works, reverse engineering (except non-commercial plugin development) and providing it as a service to others | 100% MIT. The API typings ([obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api)) are MIT-licensed |
| Stability | Breaks when the app's internals change | Breaks only when the public API changes |
| Vault | The app writes its own config/workspace files | Read-only except the note you save (see "Rules" below) |

Approach A already exists ([Ignis](https://github.com/Nystik-gh/ignis)); use it if you need every plugin.
Monolith takes approach B.

## Rules for this work

1. **Clean-room only.** Implement from the public typings (`obsidian.d.ts`) and the official developer
   docs. Never from the decompiled or minified app. Don't copy Obsidian's CSS; write our own using the
   same CSS variable and class *names*.
2. **The vault stays clean.** Plugins and themes are *read* from `.obsidian/` and never written there.
   Plugin settings (`saveData()`) are stored outside the vault (browser storage in local mode, server
   storage in server mode), unless the user explicitly opts in to writing `data.json`.
3. **Plugins are opt-in.** A plugin is arbitrary JavaScript with access to your vault, so plugins are
   off by default and enabled one by one from an explicit allowlist.
4. **Both modes.** Everything goes through the adapter interface in `js/vault.js`, so it works in local
   and server mode.

## Phases

### Phase 1: Theme & snippet compatibility
Adopt Obsidian's DOM structure and CSS variable names (`--background-primary`, `--text-normal`,
`.workspace-leaf`, `.markdown-preview-view`, …) so community themes and CSS snippets apply.
- [ ] Map Monolith's tokens and classes to Obsidian's variable/class names
- [ ] Load the active theme and enabled snippets from `.obsidian/` (read-only)
- [ ] Light/dark mode via `.theme-light` / `.theme-dark`
- [ ] Test with 3–5 popular themes; record results in the compatibility list

### Phase 2: `MetadataCache` + CodeMirror 6 editor
- [ ] Extend the in-memory index to Obsidian's `CachedMetadata` shape: headings, links, embeds, tags,
      frontmatter, blocks, list items, sections
- [ ] `metadataCache` events (`changed`, `resolved`)
- [ ] Replace the plain-text editor with CodeMirror 6 (what Obsidian uses), including **live preview**
- [ ] `Editor` / `MarkdownView` wrappers over CodeMirror

### Phase 3: Plugin loader + core API, first target: Dataview
- [ ] Load `manifest.json` + `main.js` from `.obsidian/plugins/<id>/`; evaluate as CommonJS with our
      own `require('obsidian')` module
- [ ] Core classes: `App`, `Plugin`, `Component`, `Vault`, `TFile`/`TFolder`, `Events`, `Notice`
- [ ] Rendering hooks: `registerMarkdownCodeBlockProcessor`, `registerMarkdownPostProcessor`,
      `MarkdownRenderer.render`
- [ ] Plugin settings stored outside the vault
- [ ] Opt-in UI: enable/disable each plugin, with a warning
- [ ] Target: [Dataview](https://github.com/blacksmithgu/obsidian-dataview) queries render correctly

### Phase 4: Workspace, commands, settings, more plugins
- [ ] `addCommand` + command palette, `addRibbonIcon`, `addStatusBarItem`
- [ ] `Modal`, `SuggestModal`, `FuzzySuggestModal`, `Setting`, `PluginSettingTab`
- [ ] `registerView` / custom views inside Monolith's tabs
- [ ] `registerEditorExtension` (CodeMirror extensions from plugins)
- [ ] Expand the compatibility list, guided by plugin popularity

## Compatibility list

Filled in as phases land. Statuses: ✅ works · 🟡 partial · ❌ not yet · ⛔ won't work (relies on
undocumented internals or Node/Electron-only features).

| Plugin / theme | Status | Notes |
|---|---|---|
| *(none tested yet)* | | |

## Known limits (by design)

- Plugins that rely on undocumented internals (`app.internalPlugins`, private CSS classes, Electron or
  Node APIs such as `child_process`) won't work, and we won't chase them.
- No Obsidian Sync, Publish or other paid-service features.

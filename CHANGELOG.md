# Changelog

## [1.2.0] — 2026-03-16

### Added
- Style dropdown in toolbar now renders each option (H1–H3, Paragraph, Quote) at its actual font size and weight for visual hierarchy preview
- Copy path button in Document Info panel — copies the full file path to clipboard with inline confirmation

### Fixed
- Editor no longer auto-focuses on document open (title `#` syntax no longer briefly exposed on load)
- Heading sizes now have clear hierarchy: H1 1.8em/700, H2 1.4em/600, H3 1.15em/600
- Bullet list hanging indent doubled (0.9em → 1.8em) for better readability on nested lists
- Bullet glyph baseline alignment improved via explicit line-height matching the editor scroller

## [1.1.1] — 2026-03-16

### Changed
- Editor now uses warm stone design tokens from shared module (theme, highlight, widget styles)
- Removed Figma capture script from index.html

## [1.1.0] — 2026-03-16

### Added
- Load Inter font from Google Fonts via preconnect + stylesheet links in index.html

## 0.5 Alpha — current

### Added (Phases 3–7)

**Formatting toolbar**
- Style dropdown (Paragraph, H1–H6, Quote) that reflects the cursor's current block type
- Inline formatting: Bold (`**`), Italic (`_`), Underline (`<u>…</u>`), Strikethrough (`~~`)
- Block formatting: Bullet list, Numbered list, Blockquote (`> `)
- Insert: Horizontal rule, Link (URL popover captures selection before focus is lost)
- Open file folder button at the far left of the toolbar
- Toolbar collapses/expands via a sliders icon in the top-bar right; state retained across toggles
- All commands work with or without a selection; toggle off if formatting already applied

**Formatting commands wired to editor**
- `EditorHandle` ref exposes `bold`, `italic`, `underline`, `strikethrough`, `setHeading`, `toggleBlockquote`, `toggleBulletList`, `toggleNumberedList`, `insertHorizontalRule`, `captureSelection`, `link`, `getSelection` — callable from toolbar without the toolbar touching the EditorView directly
- Active format state (`ActiveFormats`) tracked on every cursor move via `syntaxTree` traversal; drives toolbar button highlights

**Keyboard shortcuts**
- `⌘S` / `Ctrl+S` — force-save (flushes autosave debounce immediately)
- `Tab` on list items — indents (creates sub-bullet); only allowed when a parent list item is in scope to prevent 4-space lines from becoming code blocks
- `Shift+Tab` — dedents list items
- `Tab` / `Shift+Tab` elsewhere — captured by the editor (never bubbles to browser focus cycle)

**H1 title sync**
- The first `# Heading` in the document is extracted on every autosave and passed as a `frontmatter.title` override; the top-bar title and browser tab update automatically

**Link decoration**
- `[text](url)` hides the markdown syntax on non-active lines and renders as a clickable blue link
- Clicking opens the URL in a new tab without moving the cursor (mousedown + stopPropagation)
- To edit, click adjacent to the link or navigate with arrow keys

**Underline `<u>` decoration**
- `<u>text</u>` hides the tags on non-active lines and applies underline styling to the inner text via CSS inheritance

**Sub-bullets**
- Tab/Shift-Tab indent/dedent list items by 2 spaces; correctly nests within parent list context

**File browser (Phase 4)**
- Modal file browser: navigate directories, open `.md` files, create new files
- Last-visited directory persisted to `localStorage`
- `openFile(path)` updates `?file=` in the URL via `history.pushState` (no page reload)

**Landing page (Phase 4)**
- Shown when no `?file=` param; "Open file" and "New document" buttons open the file browser
- Recent files list (up to 10) with title and last-modified date; click to open directly

**Document info panel (Phase 3)**
- Slide-in right panel (`ⓘ` button in the top bar): edit title, author, status, project; add/remove tags
- Saves on blur (text fields) or immediately (tags); server stamps `modified` on every save

**Toast notifications (Phase 6)**
- Bottom-right toast component; auto-dismisses after 4s if no action button
- "File updated externally" toast with Reload button appears when the external editor has unsaved-conflicting changes; silent reload when there are no pending saves

**WebSocket live sync client (Phase 5.5)**
- `useDocument` connects to `ws://[host]/ws` on mount; auto-reconnects every 3s on drop
- `externalChanged` state triggers App.tsx to either reload silently or show the conflict toast

**AI writing assistant (Phase 7)**
- `✦` trigger button in the bottom-right; hidden when `ANTHROPIC_API_KEY` is not set
- `POST /api/chat` streams responses via SSE using `claude-haiku-4-5-20251001`
- System prompt includes full document markdown, frontmatter fields, and any selected text
- `GET /api/chat` lets the client check whether the key is configured before initialising the widget
- Panel docks as a left sidebar (`◧` button)

### Changed

- **Top bar** — app name left; document title (from frontmatter) centered; doc info `ⓘ`, controls toggle, and save status on the right; folder button moved into toolbar
- **Bullet spacing** — `paddingTop` (not `marginTop`) on list lines so CodeMirror's height tracking stays accurate and cursor placement doesn't drift
- **Link handling** — `[text](url)` now rendered as a `LinkWidget` replacing the full span; previously `LinkMark`/`URL` nodes were hidden individually which could leave stray brackets
- **Bullet widget** — replaces only the `-` mark (keeping the trailing space) so bullet and text are naturally close; `padding-left: 0.9em` hanging indent matches the actual glyph width

### Fixed

- **Server GET infinite reload loop** — `GET /api/document` previously wrote the file back on every request (the `_original_had_all_fields` flag was never set, so the condition was always true). Now only writes back when frontmatter fields were genuinely missing; calls `markOwnWrite` to suppress the resulting chokidar event.
- **Tab key bubbling to browser** — added catch-all `{ key: 'Tab', run: () => true }` bindings so Tab never escapes to browser focus cycling
- **Checkbox click** — wired via `toDOM(view)` direct listener + `stopPropagation` so clicking a checkbox doesn't reveal raw markdown; earlier `domEventHandlers` approach fired after CodeMirror had already moved the cursor
- **Cursor placement drift** — list line `marginTop` replaced with `paddingTop`; CodeMirror's `offsetHeight`-based height tracking ignores `margin` but includes `padding`
- **Tab creating code blocks** — indenting a list item that has no parent in scope is now blocked (4+ leading spaces trigger CommonMark indented code block rules at the top level)

---

## 0.5 Alpha — CodeMirror migration

### Added

- **CodeMirror source editor** replacing Milkdown WYSIWYG
- **Markup show/hide** (`markupPlugin`): syntax hidden via `Decoration.replace` on non-active lines
- **Horizontal rule rendering**, **bullet `•` glyph**, **styled checkboxes** with click-to-toggle
- **GFM extensions**: tables, strikethrough, task lists, autolinks, subscript, superscript
- **List continuation**: Enter / Backspace via `markdownKeymap`
- **`<br />` sanitization** on load

### Changed

- Replaced all `@milkdown/*` with `@codemirror/*` and `@lezer/*`
- Top bar: app identity left, document title center, save status right
- Punctuation color on active lines lightened to `#D1D5DB`

---

## 0.1 — initial build

- Express server with `GET /api/document`, `PUT /api/document`, `GET /api/browse`, `POST /api/document/new`
- `gray-matter` frontmatter parsing; auto-fills `title`, `created`, `modified` on first open
- Milkdown WYSIWYG editor (commonmark preset)
- 1-second debounced autosave with flush on unmount
- Chokidar file watcher with own-write suppression (2s window)
- WebSocket live sync (`file:changed`, `file:deleted` events) — server side
- Tailwind design token system (type scale, color palette, spacing, shadows, transitions)
- `?file=` URL parameter to open any local `.md` file

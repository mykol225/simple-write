# Simple Write

A focused local markdown editor. Write in a clean interface; a plain `.md` file on disk is always the source of truth.

**Version:** 0.5 Alpha

---

## What it does

- **File browser** — open, create, and switch files from a built-in browser; recent files shown on the landing page
- **Source + live decoration** — raw markdown is always editable; syntax hides on lines you're not on (Typora-style)
- **Formatting toolbar** — style dropdown, bold/italic/underline/strikethrough, lists, blockquote, HR, link insertion; collapses to give you full writing space
- **Autosave** — 1 second after you stop typing; ⌘S force-saves immediately
- **H1 title sync** — the first `# Heading` in your document automatically updates `frontmatter.title`
- **Live sync** — external changes (e.g. from Obsidian) show a "File updated externally" toast with a Reload button
- **Frontmatter panel** — edit title, author, status, project, and tags without touching the YAML
- **AI writing assistant** — chat with Claude about your document (requires `ANTHROPIC_API_KEY`)

---

## Getting started

### Requirements

- Node.js 18+

### Install

```bash
npm install
```

### Run

```bash
npm run dev
```

- Server: `http://localhost:3003`
- Editor: `http://localhost:3004`

Opening the editor with no URL parameters shows the **Landing page** — browse for a file or pick from recent files.

To open a specific file directly:

```
http://localhost:3004?file=/absolute/path/to/file.md
```

### Environment

```bash
cp .env.example .env
```

| Variable            | Description                                                            |
|---------------------|------------------------------------------------------------------------|
| `PORT`              | Server port (default: `3003`)                                          |
| `DATA_FILE`         | File to open when no `?file=` param is given (optional)               |
| `ANTHROPIC_API_KEY` | Enables the AI writing assistant chat widget (optional)               |

---

## Editor behavior

### Source + live decoration model

| State | What you see |
|---|---|
| Cursor on a line | Raw markdown: `## Heading`, `**bold**`, `[text](url)` |
| Cursor elsewhere | Syntax hidden; content styled (heading looks big, links are clickable, etc.) |

Click any line to edit it. Click away to hide the syntax again.

### Formatting toolbar

The toolbar sits below the top bar and can be toggled with the controls icon (⊟) at the top-right. When collapsed, only the top bar shows.

- **Style dropdown** — Paragraph, Heading 1–6, Quote
- **Inline** — Bold (`**`), Italic (`_`), Underline (`<u>`), Strikethrough (`~~`)
- **Block** — Bullet list, Numbered list, Blockquote
- **Insert** — Horizontal rule, Link (opens a URL popover)
- **Open file** — folder icon at the far left

All toolbar actions work on the current selection or, if nothing is selected, at the cursor position. Formatting toggles off if already applied.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `⌘S` / `Ctrl+S` | Force-save immediately |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⌘⇧Z` / `Ctrl+Y` | Redo |
| `Enter` in a list | Continue the list on the next line |
| `Backspace` on empty list item | Remove the list marker |
| `Tab` on a list item | Indent (create sub-bullet) |
| `Shift+Tab` on a list item | Dedent |

### Supported markdown

**CommonMark:** headings, bold, italic, inline code, code blocks, blockquotes, links, horizontal rules

**GFM extensions:** tables, task lists (`- [ ]` / `- [x]`), strikethrough (`~~`), autolinks

**Extended:** subscript, superscript, underline (`<u>`)

### Task lists

```
- [ ] Unchecked item
- [x] Checked item
```

- **Click the checkbox** to toggle. Cursor does not move; raw markdown stays hidden.
- **Click the item text** to edit the underlying `- [ ] text` markdown.

### Links

Type `[label](https://example.com)` — on non-active lines it renders as a clickable blue link. Click the link to open it; click adjacent to it (or use arrow keys) to edit the markdown.

### Lists and sub-lists

- `- `, `* `, or `+ ` starts a bullet; `1. ` starts a numbered list.
- Tab on a list item indents it (creates a sub-bullet under the previous item).
- Shift-Tab dedents.
- Tab is only allowed to indent when there is a parent list item in scope — prevents 4-space lines from being interpreted as code blocks.

### Horizontal rules

Type `---` on its own line. It renders as a full-width divider when the cursor is elsewhere.

### Autosave

Every keystroke resets a 1-second timer. When it fires, the file is saved. The top bar shows **Saving…** → **Saved** (fades after 2 seconds). Press `⌘S` to save immediately.

### H1 title sync

If your document contains a `# Heading`, its text is automatically saved as `frontmatter.title` on every autosave. The browser tab and top bar title update immediately.

---

## File browser

Click the folder icon in the toolbar (or use the Landing page) to open the file browser:

- Navigate directories (click to enter, ← to go up)
- Click any `.md` file to open it
- Type a name in the footer input and press **Create** to make a new file
- The last-visited directory is remembered between sessions

---

## Document info panel

Click **ⓘ** in the top bar to open the Document Info panel (slides in from the right):

- Editable: **Title**, **Author**, **Status**, **Project**
- Tags: add (Enter or comma), remove (×) — saved immediately
- Read-only: **Created**, **Modified** (updated automatically on every save)

---

## AI writing assistant

Set `ANTHROPIC_API_KEY` in `.env` and restart the server. A `✦` button appears in the bottom-right corner.

- The assistant has access to your full document, title, status, and project fields
- Any text you have selected is also passed as context
- Responses stream token-by-token
- Dock the panel to the left sidebar with the `◧` button

The widget is completely hidden (no button, no DOM) when the API key is not set.

---

## Live sync

The server watches the open file with chokidar. When it changes externally:

- **No unsaved changes** — editor reloads silently in the background
- **Unsaved changes in flight** — a toast appears: "File updated externally — unsaved changes may be lost" with a **Reload** button

Own writes (autosave) are suppressed: the server marks each `PUT` and ignores chokidar events within a 2-second window.

---

## API

All endpoints are on port 3003.

### `GET /api/document?file=<path>`
Returns `{ frontmatter, body }`. Auto-fills missing `title`, `created`, `modified` fields (writes back only when fields were actually missing).

### `PUT /api/document`
Saves the document. Stamps `modified` to the current timestamp.
```json
{ "file": "/abs/path/file.md", "frontmatter": {...}, "body": "markdown" }
```

### `GET /api/browse?dir=<path>`
Lists subdirectories and `.md` files. Defaults to `DATA_FILE`'s parent or `$HOME`.

### `POST /api/document/new`
Creates a new `.md` file with minimal frontmatter. Returns `{ file, frontmatter }`.
```json
{ "dir": "/abs/path", "filename": "my-note" }
```

### `GET /api/chat`
Returns `{ enabled: true }` when `ANTHROPIC_API_KEY` is set.

### `POST /api/chat`
SSE streaming chat. Body: `{ messages: [{role, content}][], viewState: {...} }`.
Streams `data: {"token":"..."}` lines, closes with `data: [DONE]`.

---

## Project structure

```
simple-write/
├── server/
│   └── index.js                Express + WebSocket server, /api/chat SSE endpoint
├── client/
│   ├── public/
│   │   └── chat-widget.js      Vanilla JS chat widget (no framework dependency)
│   └── src/
│       ├── App.tsx             Layout, routing, toolbar toggle, chat init
│       ├── main.tsx            React entry point
│       ├── index.css           Global styles + CodeMirror widget CSS
│       ├── components/
│       │   ├── Editor.tsx      CodeMirror editor, markup plugin, all formatting commands
│       │   ├── Toolbar.tsx     Formatting toolbar with style dropdown + link popover
│       │   ├── DocInfoPanel.tsx Frontmatter editor (slide-in panel)
│       │   ├── TagsEditor.tsx  Tag pill input used by DocInfoPanel
│       │   ├── FileBrowser.tsx File picker modal
│       │   ├── Landing.tsx     No-file landing page with recent files
│       │   ├── Toast.tsx       Bottom-right notifications
│       │   └── editor-types.ts Shared TypeScript interfaces (EditorHandle, ActiveFormats)
│       ├── hooks/
│       │   └── useDocument.ts  Fetch/save/reload document; WebSocket live sync
│       └── utils/
│           └── recents.ts      localStorage recent-files helpers
├── tailwind.config.ts          Design tokens (colors, type scale, shadows)
├── .env.example
└── package.json
```

---

## Tech stack

| Layer | Library |
|---|---|
| Editor | CodeMirror 6 (`@codemirror/view`, `@codemirror/state`) |
| Markdown | `@codemirror/lang-markdown` + `@lezer/markdown` (GFM) |
| UI | React 18, Tailwind CSS 3 |
| Server | Express 4, `gray-matter`, `chokidar`, `ws` |
| AI | `@anthropic-ai/sdk` |
| Build | Vite 5 |

---

## Known limitations

- `- []` without a space is not a GFM task list (`- [ ]` required)
- No image rendering in the editor
- Production build: run `npm run build` first, then `npm start`

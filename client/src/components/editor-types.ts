// Shared types for the editor ↔ toolbar ↔ App communication layer.

export interface ActiveFormats {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  headingLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6  // 0 = paragraph
  blockquote: boolean
  bulletList: boolean
  numberedList: boolean
}

export const DEFAULT_ACTIVE_FORMATS: ActiveFormats = {
  bold: false,
  italic: false,
  strikethrough: false,
  headingLevel: 0,
  blockquote: false,
  bulletList: false,
  numberedList: false,
}

/**
 * The ref handle exposed by Editor via useImperativeHandle.
 * Toolbar calls these methods; they dispatch CodeMirror transactions.
 */
export interface EditorHandle {
  // ── Inline marks ────────────────────────────────────────────────────────────
  bold(): void
  italic(): void
  underline(): void        // wraps in <u>…</u>; no active-state detection (no lezer node)
  strikethrough(): void

  // ── Block transforms ────────────────────────────────────────────────────────
  setHeading(level: 0 | 1 | 2 | 3 | 4 | 5 | 6): void  // 0 = paragraph (strip prefix)
  toggleBlockquote(): void
  toggleBulletList(): void
  toggleNumberedList(): void
  insertHorizontalRule(): void

  // ── Link (two-phase) ────────────────────────────────────────────────────────
  // Call captureSelection() on the link button's mousedown (before editor blur),
  // then call link(url) after the user enters a URL.
  captureSelection(): void
  link(url: string): void

  focus(): void
  /** Returns the currently selected text, or '' if nothing is selected. */
  getSelection(): string
}

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  EditorView, keymap, placeholder,
  ViewPlugin, Decoration, WidgetType,
} from '@codemirror/view'
import type { DecorationSet, ViewUpdate } from '@codemirror/view'
import { EditorSelection, EditorState, RangeSetBuilder } from '@codemirror/state'
import type { MutableRefObject } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown'
import { GFM, Subscript, Superscript } from '@lezer/markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import type { Frontmatter } from '../hooks/useDocument'
import type { ActiveFormats, EditorHandle } from './editor-types'
import { DEFAULT_ACTIVE_FORMATS } from './editor-types'

export type SaveStatus = 'idle' | 'saving' | 'saved'

interface Props {
  filePath: string
  initialBody: string
  frontmatter: Frontmatter
  onSave: (markdown: string) => Promise<void>
  onSaveStatusChange: (status: SaveStatus) => void
  onFormatChange?: (formats: ActiveFormats) => void
}

// ── Theme ─────────────────────────────────────────────────────────────────────

const swTheme = EditorView.theme({
  '&': {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
    fontSize: '14px',
    color: '#374151',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    overflow: 'visible',
    lineHeight: '1.8',
    fontFamily: 'inherit',
  },
  '.cm-content': {
    caretColor: '#6366F1',
    padding: '0',
    minHeight: '60vh',
  },
  '&.cm-focused': { outline: 'none !important' },
  '.cm-line': { padding: '0' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#6366F1' },
  '.cm-selectionBackground': { backgroundColor: '#EEF2FF !important' },
  '::selection': { backgroundColor: '#EEF2FF' },
  '.cm-placeholder': { color: '#9CA3AF' },
  // Hanging indent — matches the visual width of "• " (bullet + space ≈ 0.9em)
  // so wrapped continuation lines align with the start of the first line's text.
  // marginTop adds space *between* list items; wrapped lines within the same
  // item are part of the same .cm-line element so they are unaffected.
  // paddingTop (not marginTop) adds space between list items — CodeMirror
  // tracks line heights via offsetHeight which includes padding but not margin.
  // Using margin would cause click→position drift the further down the page.
  '.cm-sw-list-line': { paddingLeft: '0.9em', textIndent: '-0.9em', paddingTop: '0.35em' },
  '.cm-sw-list-line--ordered': { paddingLeft: '1.5em', textIndent: '-1.5em', paddingTop: '0.35em' },
})

// ── Syntax highlighting ───────────────────────────────────────────────────────

const swHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.4em', fontWeight: '700', color: '#111827' },
  { tag: tags.heading2, fontSize: '1.2em', fontWeight: '600', color: '#111827' },
  { tag: tags.heading3, fontSize: '1.05em', fontWeight: '600', color: '#1F2937' },
  { tag: tags.heading,  fontWeight: '600', color: '#374151' },

  { tag: tags.strong,        fontWeight: '700', color: '#111827' },
  { tag: tags.emphasis,      fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through', color: '#9CA3AF' },

  { tag: tags.link, color: '#6366F1', textDecoration: 'underline' },
  { tag: tags.url,  color: '#9CA3AF' },

  {
    tag: tags.monospace,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.875em',
    backgroundColor: '#F3F4F6',
    borderRadius: '3px',
    padding: '1px 4px',
    color: '#374151',
  },

  { tag: tags.quote, color: '#6B7280', fontStyle: 'italic' },

  { tag: tags.processingInstruction, color: '#D1D5DB' },
  { tag: tags.punctuation,           color: '#D1D5DB' },
  { tag: tags.meta,                  color: '#D1D5DB' },
  { tag: tags.atom,                  color: '#D1D5DB' },
  { tag: tags.operator,              color: '#D1D5DB' },
  { tag: tags.comment,               color: '#9CA3AF' },
])

// ── Markup show/hide plugin ───────────────────────────────────────────────────

const PUNCT_NODES = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'QuoteMark',
  'StrikethroughMark',
  // LinkMark / URL are handled by the Link node handler below (not here)
])

class EmptyWidget extends WidgetType {
  toDOM() { return document.createElement('span') }
  eq() { return true }
  ignoreEvent() { return false }
}

class HRWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-sw-hr'
    return el
  }
  eq() { return true }
  ignoreEvent() { return false }
}

class BulletWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-sw-bullet'
    el.textContent = '•'
    return el
  }
  eq() { return true }
  ignoreEvent() { return false }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly from: number, readonly to: number) { super() }

  toDOM(view: EditorView) {
    const { from, to } = this
    const box = document.createElement('span')
    box.className = 'cm-sw-checkbox' + (this.checked ? ' cm-sw-checkbox--checked' : '')

    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const current = view.state.doc.sliceString(from, to)
      view.dispatch({ changes: { from, to, insert: current === '[ ]' ? '[x]' : '[ ]' } })
    })

    if (this.checked) {
      const tick = document.createElement('span')
      tick.className = 'cm-sw-checkbox-tick'
      box.appendChild(tick)
    }
    return box
  }

  ignoreEvent() { return true }

  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.from === this.from && other.to === this.to
  }
}

// Renders a link as a clickable element. mousedown opens the URL without
// moving the cursor (same pattern as CheckboxWidget). To edit the markdown,
// the user clicks adjacent to the link or uses the keyboard — the cursor
// moving onto the line reveals the raw [text](url) for editing.
class LinkWidget extends WidgetType {
  constructor(readonly text: string, readonly url: string) { super() }

  toDOM() {
    const a = document.createElement('a')
    a.className   = 'cm-sw-link'
    a.textContent = this.text
    a.title       = this.url

    a.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      window.open(this.url, '_blank', 'noopener,noreferrer')
    })
    return a
  }

  ignoreEvent() { return true }

  eq(other: LinkWidget) { return other.text === this.text && other.url === this.url }
}

const emptyWidget  = new EmptyWidget()
const hrWidget     = new HRWidget()
const bulletWidget = new BulletWidget()

type DecoPending = { from: number; to: number; deco: Decoration }

function buildMarkupDecos(view: EditorView): DecorationSet {
  const { state } = view
  const activeLines = new Set<number>()
  for (const range of state.selection.ranges) {
    const fromLine = state.doc.lineAt(range.from).number
    const toLine   = state.doc.lineAt(range.to).number
    for (let l = fromLine; l <= toLine; l++) activeLines.add(l)
  }

  const pending: DecoPending[] = []

  syntaxTree(state).iterate({
    from: view.viewport.from,
    to:   view.viewport.to,
    enter(node) {
      const lineNum = state.doc.lineAt(node.from).number
      const active  = activeLines.has(lineNum)

      if (node.name === 'HorizontalRule') {
        if (!active) pending.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: hrWidget }) })
        return false
      }

      if (node.name === 'ListMark') {
        const text    = state.doc.sliceString(node.from, node.to).trim()
        const lineEnd = state.doc.lineAt(node.from).to
        const lineStart = state.doc.lineAt(node.from).from

        if (text === '-' || text === '*' || text === '+') {
          // Bullet list marker
          const nextSib = node.node.nextSibling
          if (!active) {
            if (nextSib?.name === 'Task') {
              // Task item — hide "- " (mark + space) before the checkbox
              pending.push({ from: node.from, to: nextSib.from, deco: Decoration.replace({ widget: emptyWidget }) })
            } else {
              // Regular bullet — replace just the mark (-/*/ +) with •, keeping
              // the trailing space so bullet and text remain naturally close.
              pending.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: bulletWidget }) })
            }
          }
          // Always add the hanging-indent line class (active or not) so the line
          // doesn't reflow when the cursor moves onto it.
          if (!nextSib || nextSib.name !== 'Task') {
            pending.push({ from: lineStart, to: lineStart, deco: Decoration.line({ class: 'cm-sw-list-line' }) })
          }
        } else if (/^\d+[.)$]/.test(text)) {
          // Ordered list marker — just apply hanging indent, keep raw text visible
          pending.push({ from: lineStart, to: lineStart, deco: Decoration.line({ class: 'cm-sw-list-line cm-sw-list-line--ordered' }) })
        }
        return false
      }

      // Inline link [text](url) → clickable LinkWidget on non-active lines.
      // Walk child nodes to extract the label text and URL.
      if (node.name === 'Link') {
        if (!active) {
          let labelFrom = -1, labelTo = -1, url = ''
          let bracketsSeen = 0
          let child = node.node.firstChild
          while (child) {
            if (child.name === 'LinkMark') {
              if (bracketsSeen === 0) labelFrom = child.to      // after [
              else if (bracketsSeen === 1) labelTo = child.from  // before ]
              bracketsSeen++
            } else if (child.name === 'URL') {
              url = state.doc.sliceString(child.from, child.to)
            }
            child = child.nextSibling
          }
          if (url && labelFrom > -1 && labelTo > -1) {
            const text = state.doc.sliceString(labelFrom, labelTo)
            pending.push({
              from: node.from, to: node.to,
              deco: Decoration.replace({ widget: new LinkWidget(text, url) }),
            })
          }
        }
        return false // skip child nodes (LinkMark, URL) regardless
      }

      if (node.name === 'TaskMarker') {
        if (!active) {
          const markerText = state.doc.sliceString(node.from, node.to)
          const checked = markerText === '[x]' || markerText === '[X]'
          pending.push({ from: node.from, to: node.to, deco: Decoration.replace({ widget: new CheckboxWidget(checked, node.from, node.to) }) })
        }
        return false
      }

      if (PUNCT_NODES.has(node.name)) {
        if (!active) {
          const extraSpace = node.name === 'HeaderMark' ? 1 : 0
          const toPos = Math.min(node.to + extraSpace, state.doc.lineAt(node.from).to)
          pending.push({ from: node.from, to: toPos, deco: Decoration.replace({ widget: emptyWidget }) })
        }
        return false
      }
    },
  })

  // ── <u>…</u> underline scan ──────────────────────────────────────────────
  // lezer-markdown has no dedicated node for <u>, so we scan visible lines
  // with a regex. On non-active lines: hide the tags, underline the content.
  // text-decoration is inherited through any nested HighlightStyle spans, so
  // a simple Decoration.mark({ class }) works correctly here.
  const uRe = /<u>(.*?)<\/u>/g
  const vpFromLine = state.doc.lineAt(view.viewport.from).number
  const vpToLine   = state.doc.lineAt(view.viewport.to).number

  for (let n = vpFromLine; n <= vpToLine; n++) {
    if (activeLines.has(n)) continue // show raw <u>…</u> on active lines
    const line = state.doc.line(n)
    uRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = uRe.exec(line.text)) !== null) {
      const openFrom  = line.from + m.index          // <u>
      const openTo    = openFrom + 3
      const closeFrom = openTo + m[1].length         // </u>
      const closeTo   = closeFrom + 4
      pending.push({ from: openFrom,  to: openTo,    deco: Decoration.replace({ widget: emptyWidget }) })
      pending.push({ from: openTo,    to: closeFrom, deco: Decoration.mark({ class: 'cm-sw-underline' }) })
      pending.push({ from: closeFrom, to: closeTo,   deco: Decoration.replace({ widget: emptyWidget }) })
    }
  }

  pending.sort((a, b) => a.from - b.from || a.to - b.to)
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to, deco } of pending) builder.add(from, to, deco)
  return builder.finish()
}

const markupPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = buildMarkupDecos(view) }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildMarkupDecos(u.view)
      }
    }
  },
  { decorations: v => v.decorations },
)

// ── Active format detection ───────────────────────────────────────────────────

function getActiveFormats(state: EditorState): ActiveFormats {
  const pos = state.selection.main.head
  const result = { ...DEFAULT_ACTIVE_FORMATS }

  let cur: ReturnType<typeof syntaxTree>['resolveInner'] extends (...a: never[]) => infer R ? R : never
  cur = syntaxTree(state).resolveInner(pos, -1) as typeof cur

  while (cur) {
    switch (cur.name) {
      case 'StrongEmphasis': result.bold = true; break
      case 'Emphasis':       result.italic = true; break
      case 'Strikethrough':  result.strikethrough = true; break
      case 'ATXHeading1': case 'SetextHeading1': result.headingLevel = 1; break
      case 'ATXHeading2': case 'SetextHeading2': result.headingLevel = 2; break
      case 'ATXHeading3': result.headingLevel = 3; break
      case 'ATXHeading4': result.headingLevel = 4; break
      case 'ATXHeading5': result.headingLevel = 5; break
      case 'ATXHeading6': result.headingLevel = 6; break
      case 'Blockquote':  result.blockquote = true; break
      case 'BulletList':  result.bulletList = true; break
      case 'OrderedList': result.numberedList = true; break
    }
    cur = cur.parent as typeof cur
  }

  return result
}

// ── List indent/dedent (Tab / Shift-Tab) ─────────────────────────────────────
// Indent a list item by prepending 2 spaces. Returns false if the current line
// is not a list item, allowing the default Tab handler to take over.
//
// IMPORTANT: CommonMark treats 4+ leading spaces as an indented code block at
// the top level. We only allow a deeper indent when there is a parent list item
// at a lower indentation level in the preceding lines — this guarantees the
// line stays inside a list context where 4-space indentation is safe.

const LIST_MARK_RE = /^(\s*)([-*+]|\d+[.)]) /

/** True if any preceding non-blank line is a list item with fewer leading spaces. */
function hasParentListItem(state: EditorState, lineNum: number, currentIndent: number): boolean {
  for (let n = lineNum - 1; n >= Math.max(1, lineNum - 50); n--) {
    const line = state.doc.line(n)
    if (line.text.trim() === '') continue
    const m = line.text.match(LIST_MARK_RE)
    if (m && m[1].length < currentIndent) return true
    // Hit non-list content at equal-or-lower indentation — out of scope
    const lineIndent = (line.text.match(/^(\s*)/)?.[1] ?? '').length
    if (!m && lineIndent < currentIndent) break
  }
  return false
}

function indentListItemCmd(view: EditorView): boolean {
  const { state } = view
  const lines: { from: number }[] = []

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last  = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      const line = state.doc.line(n)
      const m = line.text.match(LIST_MARK_RE)
      if (!m) continue
      const currentIndent = m[1].length
      // Level-0 items (currentIndent === 0) can always indent once (0 → 2 spaces).
      // Deeper items need a parent in scope to avoid triggering the code-block rule.
      if (currentIndent === 0 || hasParentListItem(state, n, currentIndent)) {
        lines.push(line)
      }
    }
  }

  if (lines.length === 0) return false
  view.dispatch({
    changes: lines.map(l => ({ from: l.from, to: l.from, insert: '  ' })),
    scrollIntoView: true,
  })
  return true
}

function dedentListItemCmd(view: EditorView): boolean {
  const changes: { from: number; to: number; insert: string }[] = []
  for (const range of view.state.selection.ranges) {
    const first = view.state.doc.lineAt(range.from).number
    const last  = view.state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) {
      const line = view.state.doc.line(n)
      const m = line.text.match(/^( {2,})([-*+]|\d+[.)]) /)
      if (m) {
        const remove = Math.min(2, m[1].length)
        changes.push({ from: line.from, to: line.from + remove, insert: '' })
      }
    }
  }
  if (changes.length === 0) return false
  view.dispatch({ changes, scrollIntoView: true })
  return true
}

// ── Editor commands ───────────────────────────────────────────────────────────
// Pure functions — each takes an EditorView and dispatches a transaction.

function wrapInlineMark(view: EditorView, open: string, close: string) {
  const { state } = view
  const { from, to, empty } = state.selection.main

  if (empty) {
    const word = state.wordAt(from)
    if (word) {
      const text = state.doc.sliceString(word.from, word.to)
      view.dispatch({
        changes: { from: word.from, to: word.to, insert: `${open}${text}${close}` },
        selection: EditorSelection.cursor(word.from + open.length + text.length + close.length),
        scrollIntoView: true,
      })
    } else {
      view.dispatch({
        changes: { from, insert: `${open}${close}` },
        selection: EditorSelection.cursor(from + open.length),
        scrollIntoView: true,
      })
    }
    view.focus()
    return
  }

  // Check if selection is already wrapped (chars just outside the selection)
  const docLen = state.doc.length
  const before = state.doc.sliceString(Math.max(0, from - open.length), from)
  const after  = state.doc.sliceString(to, Math.min(docLen, to + close.length))

  if (before === open && after === close) {
    view.dispatch({
      changes: [
        { from: from - open.length, to: from, insert: '' },
        { from: to, to: to + close.length, insert: '' },
      ],
      selection: EditorSelection.range(from - open.length, to - open.length),
      scrollIntoView: true,
    })
  } else {
    const text = state.doc.sliceString(from, to)
    view.dispatch({
      changes: { from, to, insert: `${open}${text}${close}` },
      selection: EditorSelection.range(from + open.length, from + open.length + text.length),
      scrollIntoView: true,
    })
  }
  view.focus()
}

function getSelectedLines(state: EditorState) {
  const { from, to } = state.selection.main
  const first = state.doc.lineAt(from).number
  const last  = state.doc.lineAt(to).number
  const lines = []
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n))
  return lines
}

function setHeadingCmd(view: EditorView, level: 0 | 1 | 2 | 3 | 4 | 5 | 6) {
  const lines = getSelectedLines(view.state)
  const prefix = level === 0 ? '' : '#'.repeat(level) + ' '
  const changes = lines.map(line => {
    const m = line.text.match(/^#{1,6} /)
    if (m) return { from: line.from, to: line.from + m[0].length, insert: prefix }
    return { from: line.from, to: line.from, insert: prefix }
  })
  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
}

function togglePrefixCmd(view: EditorView, prefix: string) {
  const lines = getSelectedLines(view.state)
  const allHave = lines.every(l => l.text.startsWith(prefix))
  const changes = lines.flatMap(line => {
    if (allHave) return [{ from: line.from, to: line.from + prefix.length, insert: '' }]
    if (!line.text.startsWith(prefix)) return [{ from: line.from, to: line.from, insert: prefix }]
    return []
  })
  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
}

function toggleBulletListCmd(view: EditorView) {
  const lines = getSelectedLines(view.state)
  const bulletRe = /^[-*+] /
  const numRe    = /^\d+\. /
  const allBullet = lines.every(l => bulletRe.test(l.text))

  const changes = lines.flatMap((line, i) => {
    const isBullet  = bulletRe.test(line.text)
    const isNumered = numRe.test(line.text)
    if (allBullet && isBullet) {
      const m = line.text.match(bulletRe)!
      return [{ from: line.from, to: line.from + m[0].length, insert: '' }]
    }
    if (!allBullet && isNumered) {
      const m = line.text.match(numRe)!
      return [{ from: line.from, to: line.from + m[0].length, insert: '- ' }]
    }
    if (!allBullet && !isBullet) {
      return [{ from: line.from, to: line.from, insert: '- ' }]
    }
    return []
  })
  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
}

function toggleNumberedListCmd(view: EditorView) {
  const lines = getSelectedLines(view.state)
  const bulletRe = /^[-*+] /
  const numRe    = /^\d+\. /
  const allNum = lines.every(l => numRe.test(l.text))

  let counter = 1
  const changes = lines.flatMap(line => {
    const isBullet  = bulletRe.test(line.text)
    const isNumered = numRe.test(line.text)

    if (allNum && isNumered) {
      const m = line.text.match(numRe)!
      counter++
      return [{ from: line.from, to: line.from + m[0].length, insert: '' }]
    }
    if (!allNum && isBullet) {
      const m = line.text.match(bulletRe)!
      return [{ from: line.from, to: line.from + m[0].length, insert: `${counter++}. ` }]
    }
    if (!allNum && !isNumered) {
      return [{ from: line.from, to: line.from, insert: `${counter++}. ` }]
    }
    counter++
    return []
  })
  view.dispatch({ changes, scrollIntoView: true })
  view.focus()
}

function insertHorizontalRuleCmd(view: EditorView) {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.from)
  const insert = line.text.trim() === '' ? '---\n' : '\n---\n'
  view.dispatch({
    changes: { from: line.to, to: line.to, insert },
    selection: EditorSelection.cursor(line.to + insert.length),
    scrollIntoView: true,
  })
  view.focus()
}

function captureSelectionCmd(
  view: EditorView,
  capturedRangeRef: MutableRefObject<{ from: number; to: number } | null>,
) {
  const { from, to } = view.state.selection.main
  capturedRangeRef.current = { from, to }
}

function linkCmd(
  view: EditorView,
  url: string,
  capturedRangeRef: MutableRefObject<{ from: number; to: number } | null>,
) {
  const range = capturedRangeRef.current ?? view.state.selection.main
  capturedRangeRef.current = null

  const { from, to } = range
  const selectedText = view.state.doc.sliceString(from, to)
  const label = selectedText.length > 0 ? selectedText : url
  const md = `[${label}](${url})`

  view.dispatch({
    changes: { from, to, insert: md },
    selection: EditorSelection.cursor(from + md.length),
    scrollIntoView: true,
  })
  view.focus()
}

// ── Editor component ──────────────────────────────────────────────────────────

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { initialBody, onSave, onSaveStatusChange, onFormatChange },
  ref,
) {
  const containerRef      = useRef<HTMLDivElement>(null)
  const debounceRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewRef           = useRef<EditorView | null>(null)
  const capturedRangeRef  = useRef<{ from: number; to: number } | null>(null)
  const onSaveRef         = useRef(onSave)
  const onFormatChangeRef = useRef(onFormatChange)
  onSaveRef.current         = onSave
  onFormatChangeRef.current = onFormatChange

  // Expose commands to Toolbar via the forwarded ref
  useImperativeHandle(ref, () => ({
    bold()               { if (viewRef.current) wrapInlineMark(viewRef.current, '**', '**') },
    italic()             { if (viewRef.current) wrapInlineMark(viewRef.current, '_', '_') },
    underline()          { if (viewRef.current) wrapInlineMark(viewRef.current, '<u>', '</u>') },
    strikethrough()      { if (viewRef.current) wrapInlineMark(viewRef.current, '~~', '~~') },
    setHeading(level)    { if (viewRef.current) setHeadingCmd(viewRef.current, level) },
    toggleBlockquote()   { if (viewRef.current) togglePrefixCmd(viewRef.current, '> ') },
    toggleBulletList()   { if (viewRef.current) toggleBulletListCmd(viewRef.current) },
    toggleNumberedList() { if (viewRef.current) toggleNumberedListCmd(viewRef.current) },
    insertHorizontalRule() { if (viewRef.current) insertHorizontalRuleCmd(viewRef.current) },
    captureSelection()   { if (viewRef.current) captureSelectionCmd(viewRef.current, capturedRangeRef) },
    link(url)            { if (viewRef.current) linkCmd(viewRef.current, url, capturedRangeRef) },
    focus()              { viewRef.current?.focus() },
    getSelection() {
      const view = viewRef.current
      if (!view) return ''
      const { from, to } = view.state.selection.main
      return from === to ? '' : view.state.doc.sliceString(from, to)
    },
  }), [])

  useEffect(() => {
    if (!containerRef.current) return

    const view = new EditorView({
      state: EditorState.create({
        doc: initialBody,
        extensions: [
          history(),
          keymap.of([
            // ⌘S / Ctrl+S: flush the autosave debounce and write immediately.
            // Reassures users who expect an explicit save shortcut, even though
            // autosave is always running in the background.
            {
              key: 'Mod-s',
              run: () => {
                if (debounceRef.current) {
                  clearTimeout(debounceRef.current)
                  debounceRef.current = null
                }
                const content = viewRef.current?.state.doc.toString() ?? ''
                onSaveStatusChange('saving')
                onSaveRef.current(content)
                  .then(() => onSaveStatusChange('saved'))
                  .catch(console.error)
                return true
              },
            },
            // List indent/dedent — handles Tab on list item lines
            { key: 'Tab',       run: indentListItemCmd },
            { key: 'Shift-Tab', run: dedentListItemCmd },
            // Catch-all: Tab is not in defaultKeymap (excluded for a11y), so
            // without this it bubbles to the browser and cycles focus. Capture it
            // here on any non-list line and do nothing (returning true = consumed).
            { key: 'Tab',       run: () => true },
            { key: 'Shift-Tab', run: () => true },
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          markdown({
            base: markdownLanguage,
            extensions: [GFM, Subscript, Superscript],
            codeLanguages: languages,
          }),
          syntaxHighlighting(swHighlight),
          swTheme,
          placeholder('Start writing…'),
          markupPlugin,
          EditorView.updateListener.of((update) => {
            // Autosave — unchanged
            if (update.docChanged) {
              const content = update.state.doc.toString()
              onSaveStatusChange('saving')
              if (debounceRef.current) clearTimeout(debounceRef.current)
              debounceRef.current = setTimeout(() => {
                debounceRef.current = null
                onSaveRef.current(content)
                  .then(() => onSaveStatusChange('saved'))
                  .catch(console.error)
              }, 1000)
            }
            // Active format notification — drives toolbar active states
            if ((update.docChanged || update.selectionSet) && onFormatChangeRef.current) {
              onFormatChangeRef.current(getActiveFormats(update.state))
            }
          }),
        ],
      }),
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        onSaveRef.current(view.state.doc.toString()).catch(console.error)
      }
      view.destroy()
    }
  }, [initialBody])

  return <div ref={containerRef} className="sw-editor" />
})

export default Editor

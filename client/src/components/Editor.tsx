import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  EditorView, keymap, placeholder,
} from '@codemirror/view'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { MutableRefObject } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown'
import { GFM, Subscript, Superscript } from '@lezer/markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, syntaxTree } from '@codemirror/language'
import type { Frontmatter } from '../hooks/useDocument'
import type { ActiveFormats, EditorHandle } from './editor-types'
import { DEFAULT_ACTIVE_FORMATS } from './editor-types'
import { pageEditorTheme, editorHighlight } from '@shared/editor/theme'
import { markupPlugin } from '@shared/editor/markup-plugin'
import { indentListItemCmd, dedentListItemCmd } from '@shared/editor/list-commands'

export type SaveStatus = 'idle' | 'saving' | 'saved'

interface Props {
  filePath: string
  initialBody: string
  frontmatter: Frontmatter
  onSave: (markdown: string) => Promise<void>
  onSaveStatusChange: (status: SaveStatus) => void
  onFormatChange?: (formats: ActiveFormats) => void
}

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

// ── Editor commands ───────────────────────────────────────────────────────────
// Write-specific toolbar integration. These are not shared because they assume
// a rich-text editing context with a Toolbar component — not appropriate for
// the minimal drawer editor.

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
            // ⌘S / Ctrl+S: flush autosave debounce and write immediately
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
            { key: 'Tab',       run: indentListItemCmd },
            { key: 'Shift-Tab', run: dedentListItemCmd },
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
          syntaxHighlighting(editorHighlight),
          pageEditorTheme,
          placeholder('Start writing…'),
          markupPlugin,
          EditorView.updateListener.of((update) => {
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

  return <div ref={containerRef} className="cm-md-editor" />
})

export default Editor

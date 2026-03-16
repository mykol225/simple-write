import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ActiveFormats, EditorHandle } from './editor-types'

interface ToolbarProps {
  editorRef: React.RefObject<EditorHandle>
  activeFormats: ActiveFormats
  onOpenFile: () => void
}

// ── Style dropdown ────────────────────────────────────────────────────────────
// Custom dropdown that renders each option at the font size/weight it represents.
// Uses onMouseDown + e.preventDefault() to avoid stealing editor focus.

const STYLE_OPTIONS: Array<{ value: string; label: string; style?: React.CSSProperties }> = [
  { value: '0',          label: 'Paragraph' },
  { value: '1',          label: 'Heading 1',  style: { fontSize: '1.5em',  fontWeight: '700' } },
  { value: '2',          label: 'Heading 2',  style: { fontSize: '1.25em', fontWeight: '600' } },
  { value: '3',          label: 'Heading 3',  style: { fontSize: '1.05em', fontWeight: '600' } },
  { value: '4',          label: 'Heading 4',  style: { fontWeight: '600' } },
  { value: '5',          label: 'Heading 5',  style: { fontWeight: '600' } },
  { value: '6',          label: 'Heading 6',  style: { fontWeight: '600' } },
  { value: 'blockquote', label: 'Quote',       style: { fontStyle: 'italic' } },
]

function getStyleLabel(value: string): string {
  return STYLE_OPTIONS.find(o => o.value === value)?.label ?? 'Paragraph'
}

interface StyleDropdownProps {
  value: string
  onChange: (val: string) => void
}

function StyleDropdown({ value, onChange }: StyleDropdownProps) {
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef   = useRef<HTMLDivElement>(null)

  // Close on outside click — must check both trigger and portal panel
  useEffect(() => {
    if (!open) return
    function handleDown(e: MouseEvent) {
      const t = e.target as Node
      if (
        !(triggerRef.current?.contains(t)) &&
        !(panelRef.current?.contains(t))
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [open])

  function handleToggle(e: React.MouseEvent) {
    e.preventDefault()
    if (!open && triggerRef.current) {
      // Position the panel below the trigger using fixed coords so it escapes
      // the toolbar's overflow:hidden collapse container.
      const r = triggerRef.current.getBoundingClientRect()
      setPanelStyle({ position: 'fixed', top: r.bottom + 4, left: r.left, zIndex: 9999 })
    }
    setOpen(o => !o)
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onMouseDown={handleToggle}
        aria-label="Text style"
        aria-expanded={open}
        aria-haspopup="listbox"
        className="h-7 px-2 text-body text-text-secondary bg-white rounded-sm hover:bg-surface-subtle transition-colors duration-micro min-w-[90px] text-left flex items-center gap-1 select-none"
      >
        <span className="flex-1 truncate">{getStyleLabel(value)}</span>
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true" className="shrink-0 opacity-50">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-label="Text style"
          style={panelStyle}
          className="bg-white border border-border rounded-md shadow-medium py-1 min-w-[160px]"
        >
          {STYLE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              role="option"
              aria-selected={value === opt.value}
              onMouseDown={(e) => { e.preventDefault(); onChange(opt.value); setOpen(false) }}
              style={opt.style}
              className={[
                'w-full text-left px-3 py-1 leading-snug transition-colors duration-micro select-none',
                value === opt.value
                  ? 'text-accent bg-accent-light'
                  : 'text-text-secondary hover:bg-surface-subtle',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

// ── ToolbarButton ─────────────────────────────────────────────────────────────
// All toolbar interactions use onMouseDown + e.preventDefault() so the editor
// never loses focus / selection when the user clicks a toolbar button.

interface TBtnProps {
  label: string
  active?: boolean
  title?: string
  onMouseDown: (e: React.MouseEvent) => void
  children: React.ReactNode
}

function TBtn({ label, active, title, onMouseDown, children }: TBtnProps) {
  return (
    <button
      aria-label={label}
      title={title ?? label}
      onMouseDown={(e) => {
        e.preventDefault() // keep editor focused
        onMouseDown(e)
      }}
      className={[
        'flex items-center justify-center w-7 h-7 rounded-sm select-none',
        'text-body transition-colors duration-micro',
        active
          ? 'bg-accent-light text-accent'
          : 'text-text-tertiary hover:bg-surface-subtle hover:text-text-secondary',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ── Divider ───────────────────────────────────────────────────────────────────

function Divider() {
  return <div className="w-px h-4 bg-border mx-1 shrink-0" />
}

// ── LinkButton with URL popover ───────────────────────────────────────────────

interface LinkButtonProps {
  editorRef: React.RefObject<EditorHandle>
}

function LinkButton({ editorRef }: LinkButtonProps) {
  const [open, setOpen]     = useState(false)
  const [url, setUrl]       = useState('')
  const popoverRef          = useRef<HTMLDivElement>(null)
  const inputRef            = useRef<HTMLInputElement>(null)

  // Close on click-outside
  useEffect(() => {
    if (!open) return
    function handleDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
        setUrl('')
      }
    }
    document.addEventListener('mousedown', handleDown)
    return () => document.removeEventListener('mousedown', handleDown)
  }, [open])

  function handleInsert() {
    if (!url.trim()) return
    editorRef.current?.link(url.trim())
    setOpen(false)
    setUrl('')
  }

  return (
    <div className="relative">
      <TBtn
        label="Insert link"
        title="Link"
        onMouseDown={() => {
          editorRef.current?.captureSelection()
          setOpen(true)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
      >
        {/* Chain-link icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
      </TBtn>

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full left-0 mt-1.5 z-50 flex items-center gap-2 p-2 bg-white border border-border rounded-md shadow-medium min-w-[260px]"
        >
          <input
            ref={inputRef}
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleInsert() }
              if (e.key === 'Escape') { setOpen(false); setUrl(''); editorRef.current?.focus() }
            }}
            placeholder="https://"
            className="flex-1 text-body text-text-primary border border-border rounded-sm px-2 py-1 focus:outline-none focus:border-accent transition-colors duration-standard"
          />
          <button
            onMouseDown={e => { e.preventDefault(); handleInsert() }}
            className="text-label font-medium bg-accent text-white px-3 py-1 rounded-sm hover:bg-accent-hover transition-colors duration-micro shrink-0"
          >
            Insert
          </button>
        </div>
      )}
    </div>
  )
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

export default function Toolbar({ editorRef, activeFormats, onOpenFile }: ToolbarProps) {
  const cmd = editorRef.current

  // Style dropdown: derive current value from activeFormats
  // Blockquote isn't a heading level, so we use a special sentinel
  const styleValue = activeFormats.blockquote ? 'blockquote' : String(activeFormats.headingLevel)

  function handleStyleChange(val: string) {
    if (val === 'blockquote') {
      editorRef.current?.toggleBlockquote()
    } else {
      editorRef.current?.setHeading(Number(val) as 0 | 1 | 2 | 3 | 4 | 5 | 6)
    }
    editorRef.current?.focus()
  }

  return (
    <div className="flex items-center gap-0.5 px-4 py-1.5 border-b border-border bg-white shrink-0 select-none">

      {/* ── Open file — far left ────────────────────────────────── */}
      <TBtn label="Open file" title="Open file" onMouseDown={onOpenFile}>
        <svg width="15" height="13" viewBox="0 0 15 13" fill="none" aria-hidden="true">
          <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1H6a.5.5 0 0 1 .354.146L7.5 2.5H12.5A1.5 1.5 0 0 1 14 4v6.5A1.5 1.5 0 0 1 12.5 12h-10A1.5 1.5 0 0 1 1 10.5V2.5Z" stroke="currentColor" strokeWidth="1.1" fill="none"/>
        </svg>
      </TBtn>

      <Divider />

      {/* ── Style dropdown ─────────────────────────────────────── */}
      <StyleDropdown value={styleValue} onChange={handleStyleChange} />

      <Divider />

      {/* ── Inline: Bold, Italic, Underline, Strikethrough ────── */}
      <TBtn label="Bold" active={activeFormats.bold} onMouseDown={() => cmd?.bold()}>
        <span className="font-bold">B</span>
      </TBtn>
      <TBtn label="Italic" active={activeFormats.italic} onMouseDown={() => cmd?.italic()}>
        <span className="italic font-medium">I</span>
      </TBtn>
      <TBtn label="Underline" onMouseDown={() => cmd?.underline()}>
        <span className="underline">U</span>
      </TBtn>
      <TBtn label="Strikethrough" active={activeFormats.strikethrough} onMouseDown={() => cmd?.strikethrough()}>
        <span className="line-through">S</span>
      </TBtn>

      <Divider />

      {/* ── Block: Bullet, Numbered, Blockquote ───────────────── */}
      <TBtn label="Bullet list" active={activeFormats.bulletList} onMouseDown={() => cmd?.toggleBulletList()}>
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
          <circle cx="2" cy="4.5" r="1.25" fill="currentColor"/>
          <rect x="5" y="3.75" width="8" height="1.5" rx="0.75" fill="currentColor"/>
          <circle cx="2" cy="7.5" r="1.25" fill="currentColor"/>
          <rect x="5" y="6.75" width="8" height="1.5" rx="0.75" fill="currentColor"/>
          <circle cx="2" cy="10.5" r="1.25" fill="currentColor"/>
          <rect x="5" y="9.75" width="8" height="1.5" rx="0.75" fill="currentColor"/>
        </svg>
      </TBtn>
      <TBtn label="Numbered list" active={activeFormats.numberedList} onMouseDown={() => cmd?.toggleNumberedList()}>
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
          <text x="1" y="5.5" fontSize="4.5" fill="currentColor" fontFamily="monospace">1.</text>
          <rect x="6" y="3.75" width="7" height="1.5" rx="0.75" fill="currentColor"/>
          <text x="1" y="8.5" fontSize="4.5" fill="currentColor" fontFamily="monospace">2.</text>
          <rect x="6" y="6.75" width="7" height="1.5" rx="0.75" fill="currentColor"/>
          <text x="1" y="11.5" fontSize="4.5" fill="currentColor" fontFamily="monospace">3.</text>
          <rect x="6" y="9.75" width="7" height="1.5" rx="0.75" fill="currentColor"/>
        </svg>
      </TBtn>
      <TBtn label="Blockquote" active={activeFormats.blockquote} onMouseDown={() => cmd?.toggleBlockquote()}>
        <span className="text-title leading-none">›</span>
      </TBtn>

      <Divider />

      {/* ── Insert: HR, Link ──────────────────────────────────── */}
      <TBtn label="Horizontal rule" onMouseDown={() => cmd?.insertHorizontalRule()}>
        <span className="text-subtitle leading-none font-medium">—</span>
      </TBtn>
      <LinkButton editorRef={editorRef} />


    </div>
  )
}

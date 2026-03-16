import { useEffect, useRef, useState } from 'react'
import type { Frontmatter } from '../hooks/useDocument'
import TagsEditor from './TagsEditor'

interface DocInfoPanelProps {
  frontmatter: Frontmatter
  filePath: string | null
  onSave: (overrides: Partial<Frontmatter>) => Promise<void>
  onClose: () => void
  isOpen: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return '—'
  }
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-text-tertiary uppercase tracking-wide">
        {label}
      </span>
      {children}
    </div>
  )
}

const inputClass =
  'text-body text-text-primary border border-border rounded-sm px-2.5 py-1.5 w-full ' +
  'focus:outline-none focus:border-accent transition-colors duration-standard bg-white'

// ── DocInfoPanel ──────────────────────────────────────────────────────────────

export default function DocInfoPanel({ frontmatter, filePath, onSave, onClose, isOpen }: DocInfoPanelProps) {
  // Local draft — re-initialized from frontmatter whenever the panel opens
  const [draft, setDraft] = useState<Partial<Frontmatter>>({})
  const [copied, setCopied] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>()

  // Clear copy confirmation timer on unmount to avoid state update on an unmounted component
  useEffect(() => {
    return () => clearTimeout(copyTimeoutRef.current)
  }, [])

  useEffect(() => {
    if (isOpen) {
      setDraft({
        title:   frontmatter.title   ?? '',
        author:  frontmatter.author  ?? '',
        status:  frontmatter.status  ?? '',
        project: frontmatter.project ?? '',
        tags:    frontmatter.tags    ?? [],
      })
    }
  }, [isOpen]) // intentionally only runs when isOpen changes — not on every frontmatter update

  function handleBlur() {
    onSave(draft).catch(console.error)
  }

  function handleCopyPath() {
    if (!filePath) return
    navigator.clipboard.writeText(filePath).then(() => {
      setCopied(true)
      clearTimeout(copyTimeoutRef.current)
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 1500)
    }).catch(console.error)
  }

  function handleTagsChange(tags: string[]) {
    const next = { ...draft, tags }
    setDraft(next)
    onSave(next).catch(console.error)
  }

  if (!isOpen) return null

  return (
    <>
      {/* Click-outside backdrop — sits behind the panel */}
      <div
        className="fixed inset-0 z-30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Document info"
        className="fixed inset-y-0 right-0 w-80 bg-white border-l border-border shadow-elevated z-40 flex flex-col animate-slide-in"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <span className="text-subtitle font-semibold text-text-primary">Document Info</span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-text-tertiary hover:text-text-secondary rounded-sm hover:bg-surface-subtle transition-colors duration-micro"
            aria-label="Close document info"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">

          <Field label="Title">
            <input
              value={draft.title ?? ''}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              onBlur={handleBlur}
              className={inputClass}
              placeholder="Untitled"
            />
          </Field>

          <Field label="Author">
            <input
              value={draft.author ?? ''}
              onChange={e => setDraft(d => ({ ...d, author: e.target.value }))}
              onBlur={handleBlur}
              className={inputClass}
              placeholder="—"
            />
          </Field>

          <Field label="Status">
            <input
              value={draft.status ?? ''}
              onChange={e => setDraft(d => ({ ...d, status: e.target.value }))}
              onBlur={handleBlur}
              className={inputClass}
              placeholder="—"
            />
          </Field>

          <Field label="Project">
            <input
              value={draft.project ?? ''}
              onChange={e => setDraft(d => ({ ...d, project: e.target.value }))}
              onBlur={handleBlur}
              className={inputClass}
              placeholder="—"
            />
          </Field>

          <Field label="Tags">
            <TagsEditor
              tags={(draft.tags as string[]) ?? []}
              onChange={handleTagsChange}
            />
          </Field>

          <div className="w-full h-px bg-border" />

          <Field label="Created">
            <span className="text-body text-text-tertiary">{formatDate(frontmatter.created)}</span>
          </Field>

          <Field label="Modified">
            <span className="text-body text-text-tertiary">{formatDate(frontmatter.modified)}</span>
          </Field>

          {filePath && (
            <button
              onClick={handleCopyPath}
              className="flex items-center gap-2 text-label text-text-tertiary hover:text-accent transition-colors duration-micro py-1 group"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>{copied ? 'Copied!' : 'Copy path'}</span>
            </button>
          )}

        </div>
      </div>
    </>
  )
}

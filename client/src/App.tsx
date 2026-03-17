import { useState, useEffect, useRef, useCallback } from 'react'
import { useDocument } from './hooks/useDocument'
import type { Frontmatter } from './hooks/useDocument'
import Editor, { type SaveStatus } from './components/Editor'
import type { EditorHandle } from './components/editor-types'
import { DEFAULT_ACTIVE_FORMATS } from './components/editor-types'
import type { ActiveFormats } from './components/editor-types'
import Toolbar from './components/Toolbar'
import DocInfoPanel from './components/DocInfoPanel'
import FileBrowser from './components/FileBrowser'
import Landing from './components/Landing'
import Toast from './components/Toast'
import type { ToastData } from './components/Toast'
import { addToRecents } from './utils/recents'
import StatusBar from '@shared/components/StatusBar'

// Type declaration for the globally-loaded chat-widget.js
declare const ChatWidget: {
  init(opts: { endpoint: string; getViewState: () => unknown }): void
  setViewState(state: unknown): void
} | undefined

export default function App() {
  // filePath is mutable — changes when the user opens a different file.
  // Initialised from ?file= so direct URLs and bookmarks work.
  const [filePath, setFilePath] = useState<string | null>(() => {
    return new URLSearchParams(window.location.search).get('file')
  })

  const [fileBrowserOpen, setFileBrowserOpen] = useState(false)

  const { frontmatter, body, isLoading, error, save, reload, externalChanged } = useDocument(filePath)
  const [saveStatus, setSaveStatus]       = useState<SaveStatus>('idle')
  const [activeFormats, setActiveFormats] = useState<ActiveFormats>(DEFAULT_ACTIVE_FORMATS)
  const [docInfoOpen, setDocInfoOpen]     = useState(false)
  const [toolbarOpen, setToolbarOpen]     = useState(true)
  const [toast, setToast]                 = useState<ToastData | null>(null)

  const editorRef = useRef<EditorHandle>(null)
  const bodyRef        = useRef(body)
  const frontmatterRef = useRef(frontmatter)
  bodyRef.current        = body
  frontmatterRef.current = frontmatter

  // ── Open a file ───────────────────────────────────────────────────────────
  // Updates the URL so the session is bookmarkable, then switches the editor.

  const openFile = useCallback((path: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('file', path)
    history.pushState({}, '', url.toString())
    setFilePath(path)
    setFileBrowserOpen(false)
  }, [])

  // ── Save helpers ─────────────────────────────────────────────────────────

  // H1 title sync — extract the first # heading from the markdown on every
  // save and pass it as a frontmatter override so frontmatter.title stays
  // in sync without the user having to edit it manually.
  const saveWithTitleSync = useCallback(async (markdown: string) => {
    const h1 = markdown.match(/^#\s+(.+?)$/m)
    const title = h1 ? h1[1].trim() : undefined
    return save(markdown, title !== undefined ? { title } : undefined)
  }, [save])

  // Save only frontmatter (from DocInfoPanel) — body stays unchanged.
  const saveFrontmatter = useCallback(
    (fm: Partial<Frontmatter>) => save(bodyRef.current, fm),
    [save],
  )

  // ── Side effects ──────────────────────────────────────────────────────────

  // Reflect document title in the browser tab
  useEffect(() => {
    const name = frontmatter?.title || filePath?.split('/').pop() || 'Untitled'
    document.title = `${name} — Simple Write`
  }, [frontmatter?.title, filePath])

  // Auto-fade the "Saved" indicator after 2s
  useEffect(() => {
    if (saveStatus !== 'saved') return
    const t = setTimeout(() => setSaveStatus('idle'), 2000)
    return () => clearTimeout(t)
  }, [saveStatus])

  // Keep a stable ref so the external-change effect can read saveStatus without
  // including it as a dependency (which would cause the effect to re-run every
  // time the user types).
  const saveStatusRef = useRef(saveStatus)
  saveStatusRef.current = saveStatus

  // Handle external file changes (Phase 5.5).
  // If the user has no unsaved changes in flight → reload silently, no toast.
  // If a save is pending → show a toast so the user can decide.
  useEffect(() => {
    if (!externalChanged) return
    if (saveStatusRef.current === 'saving') {
      setToast({
        message: 'File updated externally — unsaved changes may be lost',
        action: {
          label: 'Reload',
          onClick: () => { reload(); setToast(null) },
        },
      })
    } else {
      reload() // silent — no pending changes to lose
    }
  }, [externalChanged, reload])

  // Track recently-opened files for the Landing page
  useEffect(() => {
    if (!filePath || isLoading || error) return
    addToRecents({
      path:     filePath,
      title:    frontmatter.title || filePath.split('/').pop() || '',
      modified: frontmatter.modified,
    })
  }, [filePath, isLoading, error, frontmatter.title, frontmatter.modified])

  // ── Chat widget ───────────────────────────────────────────────────────────
  // Initialise once on mount. getViewState reads from stable refs so it always
  // returns current content without needing to be recreated.
  // The widget is hidden (never initialised) when ANTHROPIC_API_KEY is not set.
  useEffect(() => {
    if (typeof ChatWidget === 'undefined') return
    fetch('/api/chat')
      .then(r => r.json())
      .then(({ enabled }) => {
        if (!enabled) return
        ChatWidget.init({
          endpoint: '/api/chat',
          getViewState: () => ({
            document:     bodyRef.current,
            title:        frontmatterRef.current.title,
            status:       frontmatterRef.current.status,
            project:      frontmatterRef.current.project,
            selectedText: editorRef.current?.getSelection() ?? '',
          }),
        })
      })
      .catch(() => { /* no chat if server unreachable */ })
  }, []) // run once — getViewState always reads fresh data via refs

  // ── No file open — show Landing ───────────────────────────────────────────

  if (!filePath) {
    return <Landing onOpenFile={openFile} />
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-page">
        <p className="text-body text-text-tertiary">Loading…</p>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-surface-page">
        <div className="text-center max-w-md">
          <p className="text-body text-status-blocked font-medium mb-2">Could not open file</p>
          <p className="text-label text-text-tertiary">{error}</p>
          <p className="text-label text-text-tertiary mt-1 font-mono break-all">{filePath}</p>
          <button
            onClick={() => setFilePath(null)}
            className="mt-4 text-label text-accent hover:text-accent-hover transition-colors"
          >
            ← Back to files
          </button>
        </div>
      </div>
    )
  }

  // ── Editor ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-white">

      {/* Top bar — logo left · title center · controls right */}
      <header className="shrink-0 h-12 bg-white border-b border-[#ebe9e5] relative">

        {/* Left: logo · version · badge · close */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pl-4">
          <img src="/logo.png" alt="Simple Write" className="h-5 w-auto" />
          <span className="text-[12px] text-[#9ca3af] font-normal">0.5</span>
          <span className="text-[11px] font-medium text-[#92400e] bg-[#fef3c7] px-1.5 py-[2px] rounded-full leading-none whitespace-nowrap">Alpha</span>
          <button
            onClick={() => {
              history.pushState({}, '', window.location.pathname)
              setFilePath(null)
            }}
            title="Close document"
            className="ml-1 w-5 h-5 flex items-center justify-center text-[#9ca3af] hover:text-[#6b7280] hover:bg-[#f5f3f0] rounded transition-colors"
            aria-label="Close document"
          >
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
              <line x1="1" y1="1" x2="8" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              <line x1="8" y1="1" x2="1" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Center: document title — truly centered in the bar */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-4">
          <span className="text-[12px] text-[#a8a28b] whitespace-nowrap">
            {frontmatter?.title || filePath.split('/').pop()}
          </span>
        </div>

        {/* Right: save status · info · toolbar toggle */}
        <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-[9px] pr-4">
          <span
            className={`text-[11px] text-[#9ca3af] transition-opacity duration-standard ${
              saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Saved'}
          </span>

          {/* Document info */}
          <button
            onClick={() => setDocInfoOpen(true)}
            title="Document info"
            aria-label="Document info"
            className="w-7 h-7 rounded-[6px] flex items-center justify-center text-[#80786b] hover:bg-[#f5f3f0] transition-colors duration-micro"
          >
            <span className="text-[13px] font-semibold leading-none">ⓘ</span>
          </button>

          {/* Toolbar toggle */}
          <button
            onClick={() => setToolbarOpen(o => !o)}
            title={toolbarOpen ? 'Hide controls' : 'Show controls'}
            aria-label={toolbarOpen ? 'Hide controls' : 'Show controls'}
            className={`w-7 h-7 rounded-[6px] flex items-center justify-center transition-colors duration-micro ${
              toolbarOpen
                ? 'bg-[#fffcf1] text-[#92400e]'
                : 'text-[#80786b] hover:bg-[#f5f3f0]'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 3h12M1 7h12M1 11h12" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
              <circle cx="4"  cy="3"  r="1.5" fill="white" stroke="currentColor" strokeWidth="1.25"/>
              <circle cx="10" cy="7"  r="1.5" fill="white" stroke="currentColor" strokeWidth="1.25"/>
              <circle cx="6"  cy="11" r="1.5" fill="white" stroke="currentColor" strokeWidth="1.25"/>
            </svg>
          </button>
        </div>

      </header>

      {/* Formatting toolbar — collapses smoothly via max-height.
          overflow is visible when open so the style dropdown (absolutely positioned)
          can escape the container; hidden only during/after collapse to clip content. */}
      <div
        style={{
          maxHeight: toolbarOpen ? '48px' : '0',
          overflow: toolbarOpen ? 'visible' : 'hidden',
          transition: 'max-height 150ms ease',
        }}
      >
        <Toolbar
          editorRef={editorRef}
          activeFormats={activeFormats}
          onOpenFile={() => setFileBrowserOpen(true)}
        />
      </div>

      {/* Scrollable editor column */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-10">
          <Editor
            key={filePath}
            ref={editorRef}
            filePath={filePath}
            initialBody={body}
            frontmatter={frontmatter}
            onSave={saveWithTitleSync}
            onSaveStatusChange={setSaveStatus}
            onFormatChange={setActiveFormats}
          />
        </div>
      </div>

      {/* Overlays */}
      <FileBrowser
        isOpen={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
        onOpenFile={openFile}
      />

      <DocInfoPanel
        frontmatter={frontmatter}
        filePath={filePath}
        onSave={saveFrontmatter}
        onClose={() => setDocInfoOpen(false)}
        isOpen={docInfoOpen}
      />

      {toast && (
        <Toast
          message={toast.message}
          action={toast.action}
          onDismiss={() => setToast(null)}
        />
      )}

      <StatusBar
        appName="Simple Write"
        getContext={() => ({
          file:       filePath ?? null,
          saveStatus,
          wordCount:  body ? body.trim().split(/\s+/).filter(Boolean).length : 0,
        })}
      />
    </div>
  )
}

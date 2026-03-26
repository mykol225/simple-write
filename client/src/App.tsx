import { useState, useEffect, useRef, useCallback } from 'react'
import { useDocument } from './hooks/useDocument'
import type { Frontmatter } from './hooks/useDocument'
import Editor, { type SaveStatus } from './components/Editor'
import type { EditorHandle } from './components/editor-types'
import { DEFAULT_ACTIVE_FORMATS } from './components/editor-types'
import type { ActiveFormats } from './components/editor-types'
import Toolbar from './components/Toolbar'
import DocInfoPanel from './components/DocInfoPanel'
import FileBrowser from '@shared/components/FileBrowser'
import AppHeader from '@shared/components/AppHeader'
import { HeaderIconButton } from '@shared/components/AppHeader'
import type { AppTab } from '@shared/components/AppHeader'
import Landing from './components/Landing'
import Toast from './components/Toast'
import type { ToastData } from './components/Toast'
import { addToRecents } from './utils/recents'
import StatusBar from '@shared/components/StatusBar'
import ChatWidget from '@shared/components/ChatWidget'

// ── Tab types ─────────────────────────────────────────────────────────────────

interface WriteTab {
  id: string
  filePath: string
  title: string
}

function loadTabs(): WriteTab[] {
  try {
    const saved = localStorage.getItem('sw:tabs')
    return saved ? (JSON.parse(saved) as WriteTab[]) : []
  } catch { return [] }
}

function loadActiveTabId(): string | null {
  return localStorage.getItem('sw:activeTab')
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Tab state ─────────────────────────────────────────────────────────────
  const [tabs, setTabs] = useState<WriteTab[]>(() => {
    const saved = loadTabs()
    // Migrate from old single-file URL state on first load
    if (saved.length === 0) {
      const urlFile = new URLSearchParams(window.location.search).get('file')
      if (urlFile) {
        return [{ id: crypto.randomUUID(), filePath: urlFile, title: urlFile.split('/').pop() ?? '' }]
      }
    }
    return saved
  })

  const [activeTabId, setActiveTabId] = useState<string | null>(() => {
    const saved = loadTabs()
    const savedActive = loadActiveTabId()
    // Migrate from URL state
    if (saved.length === 0) {
      const urlFile = new URLSearchParams(window.location.search).get('file')
      if (urlFile) return null // will be set after tabs are created below
    }
    // Verify the saved active tab still exists
    if (savedActive && saved.some(t => t.id === savedActive)) return savedActive
    return saved[0]?.id ?? null
  })

  // Correct activeTabId if tabs were just initialized from URL migration
  useEffect(() => {
    if (tabs.length > 0 && !activeTabId) {
      setActiveTabId(tabs[0].id)
    }
  }, []) // intentionally only on mount

  // Persist tabs to localStorage
  useEffect(() => {
    localStorage.setItem('sw:tabs', JSON.stringify(tabs))
  }, [tabs])

  useEffect(() => {
    if (activeTabId) localStorage.setItem('sw:activeTab', activeTabId)
    else localStorage.removeItem('sw:activeTab')
  }, [activeTabId])

  // Derived: active file path
  const activeTab = tabs.find(t => t.id === activeTabId) ?? null
  const filePath = activeTab?.filePath ?? null

  // ── File state (single document at a time) ────────────────────────────────
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

  // ── Tab management ────────────────────────────────────────────────────────

  const openFile = useCallback((path: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('file', path)
    history.pushState({}, '', url.toString())

    // If already open in a tab, just switch to it
    const existing = tabs.find(t => t.filePath === path)
    if (existing) {
      setActiveTabId(existing.id)
      setFileBrowserOpen(false)
      return
    }

    // Create a new tab
    const newTab: WriteTab = {
      id: crypto.randomUUID(),
      filePath: path,
      title: path.split('/').pop() ?? '',
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
    setFileBrowserOpen(false)
  }, [tabs])

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id)
      const next = prev.filter(t => t.id !== id)

      if (id === activeTabId) {
        const newActiveTab = next[Math.max(0, idx - 1)] ?? null
        if (newActiveTab) {
          setActiveTabId(newActiveTab.id)
          const url = new URL(window.location.href)
          url.searchParams.set('file', newActiveTab.filePath)
          history.pushState({}, '', url.toString())
        } else {
          setActiveTabId(null)
          history.pushState({}, '', window.location.pathname)
        }
      }

      return next
    })
  }, [activeTabId])

  const switchTab = useCallback((id: string) => {
    const tab = tabs.find(t => t.id === id)
    if (!tab) return
    setActiveTabId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('file', tab.filePath)
    history.pushState({}, '', url.toString())
  }, [tabs])

  const reorderTabs = useCallback((dragId: string, beforeId: string) => {
    setTabs(prev => {
      const dragIdx = prev.findIndex(t => t.id === dragId)
      const beforeIdx = prev.findIndex(t => t.id === beforeId)
      if (dragIdx === -1 || beforeIdx === -1) return prev
      const next = [...prev]
      const [removed] = next.splice(dragIdx, 1)
      // After removing the dragged item, recalculate target index
      const adjustedBefore = dragIdx < beforeIdx ? beforeIdx - 1 : beforeIdx
      next.splice(adjustedBefore, 0, removed)
      return next
    })
  }, [])

  // Update tab title when the document's frontmatter title loads
  useEffect(() => {
    if (!activeTabId || !filePath) return
    const title = frontmatter?.title || filePath.split('/').pop() || ''
    setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, title } : t))
  }, [frontmatter?.title, filePath, activeTabId])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey) return
      if (e.key === 'w') {
        // Don't intercept if focused inside a text input (let browser handle)
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        e.preventDefault()
        if (activeTabId) closeTab(activeTabId)
      } else if (e.key === 't') {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        e.preventDefault()
        setFileBrowserOpen(true)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeTabId, closeTab])

  // ── Build tab list for TabBar ─────────────────────────────────────────────

  const tabBarTabs: AppTab[] = tabs.map(t => ({
    id: t.id,
    label: t.title || t.filePath.split('/').pop() || 'Untitled',
    isDirty: t.id === activeTabId && saveStatus === 'saving',
  }))

  // ── Save helpers ─────────────────────────────────────────────────────────

  const saveWithTitleSync = useCallback(async (markdown: string) => {
    const h1 = markdown.match(/^#\s+(.+?)$/m)
    const title = h1 ? h1[1].trim() : undefined
    return save(markdown, title !== undefined ? { title } : undefined)
  }, [save])

  const saveFrontmatter = useCallback(
    (fm: Partial<Frontmatter>) => save(bodyRef.current, fm),
    [save],
  )

  // ── Side effects ──────────────────────────────────────────────────────────

  useEffect(() => {
    const name = frontmatter?.title || filePath?.split('/').pop() || 'Untitled'
    document.title = `${name} — Simple Write`
  }, [frontmatter?.title, filePath])

  useEffect(() => {
    if (saveStatus !== 'saved') return
    const t = setTimeout(() => setSaveStatus('idle'), 2000)
    return () => clearTimeout(t)
  }, [saveStatus])

  const saveStatusRef = useRef(saveStatus)
  saveStatusRef.current = saveStatus

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
      reload()
    }
  }, [externalChanged, reload])

  useEffect(() => {
    if (!filePath || isLoading || error) return
    addToRecents({
      path:     filePath,
      title:    frontmatter.title || filePath.split('/').pop() || '',
      modified: frontmatter.modified,
    })
  }, [filePath, isLoading, error, frontmatter.title, frontmatter.modified])

  // ── No file open — show Landing ───────────────────────────────────────────

  if (!filePath) {
    return <Landing onOpenFile={openFile} />
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-full flex flex-col bg-surface-page">
        <AppHeader
          iconSrc="/icon.png"
          iconAlt="Simple Write"
          tabs={tabBarTabs}
          activeTabId={activeTabId}
          onTabSelect={switchTab}
          onTabClose={closeTab}
          onTabReorder={reorderTabs}
          onTabAdd={() => setFileBrowserOpen(true)}
        />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-body text-text-tertiary">Loading…</p>
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="h-full flex flex-col bg-surface-page">
        <AppHeader
          iconSrc="/icon.png"
          iconAlt="Simple Write"
          tabs={tabBarTabs}
          activeTabId={activeTabId}
          onTabSelect={switchTab}
          onTabClose={closeTab}
          onTabReorder={reorderTabs}
          onTabAdd={() => setFileBrowserOpen(true)}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <p className="text-body text-status-blocked font-medium mb-2">Could not open file</p>
            <p className="text-label text-text-tertiary">{error}</p>
            <p className="text-label text-text-tertiary mt-1 font-mono break-all">{filePath}</p>
            <button
              onClick={() => activeTabId && closeTab(activeTabId)}
              className="mt-4 text-label text-accent hover:text-accent-hover transition-colors"
            >
              ← Close tab
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Editor ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-white">

      {/* Unified header — icon · tabs · actions */}
      <AppHeader
        iconSrc="/icon.png"
        iconAlt="Simple Write"
        tabs={tabBarTabs}
        activeTabId={activeTabId}
        onTabSelect={switchTab}
        onTabClose={closeTab}
        onTabReorder={reorderTabs}
        onTabAdd={() => setFileBrowserOpen(true)}
        renderActions={() => (
          <>
            <span
              style={{
                fontSize: 11,
                color: '#9ca3af',
                transition: 'opacity 150ms',
                opacity: saveStatus === 'idle' ? 0 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Saved'}
            </span>

            <HeaderIconButton
              label="Document info"
              isMultiTab={tabs.length >= 2}
              onClick={() => setDocInfoOpen(o => !o)}
            >
              <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1 }}>ⓘ</span>
            </HeaderIconButton>

            <HeaderIconButton
              label={toolbarOpen ? 'Hide controls' : 'Show controls'}
              active={toolbarOpen}
              isMultiTab={tabs.length >= 2}
              onClick={() => setToolbarOpen(o => !o)}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M1 3h12M1 7h12M1 11h12" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                <circle cx="4"  cy="3"  r="1.5" fill="white" stroke="currentColor" strokeWidth="1.25"/>
                <circle cx="10" cy="7"  r="1.5" fill="white" stroke="currentColor" strokeWidth="1.25"/>
                <circle cx="6"  cy="11" r="1.5" fill="white" stroke="currentColor" strokeWidth="1.25"/>
              </svg>
            </HeaderIconButton>
          </>
        )}
      />

      {/* Formatting toolbar — collapses smoothly via max-height */}
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
        onSelect={openFile}
        mode="file"
        browseEndpoint="/api/browse"
        extensions={['.md']}
        allowCreate
        createEndpoint="/api/document/new"
        storagePrefix="sw"
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
        appLabel="Simple Write"
        version="0.5"
        stage="Alpha"
        getContext={() => ({
          file:       filePath ?? null,
          saveStatus,
          wordCount:  body ? body.trim().split(/\s+/).filter(Boolean).length : 0,
        })}
      />

      <ChatWidget
        title="Writing assistant"
        getContext={() => {
          const fm = frontmatterRef.current
          const parts: string[] = [
            `File: ${filePath ?? 'Untitled'}`,
            fm.title    ? `Title: ${fm.title}`     : '',
            fm.status   ? `Status: ${fm.status}`   : '',
            fm.project  ? `Project: ${fm.project}` : '',
            '',
            'Content:',
            bodyRef.current || '(empty document)',
          ]
          const sel = editorRef.current?.getSelection()
          if (sel) parts.push(`\nSelected text:\n${sel}`)
          return parts.filter(l => l !== '').join('\n')
        }}
      />
    </div>
  )
}

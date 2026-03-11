import { useEffect, useRef, useState } from 'react'

interface FileBrowserProps {
  isOpen: boolean
  onClose: () => void
  onOpenFile: (path: string) => void
}

// ── Path utilities (browser-safe, for absolute paths) ─────────────────────────

const joinPath  = (base: string, name: string) => base.replace(/\/$/, '') + '/' + name
const parentDir = (p: string) => p.replace(/\/$/, '').split('/').slice(0, -1).join('/') || '/'
const basename  = (p: string) => p.replace(/\/$/, '').split('/').pop() ?? p

// Persist the last-visited directory between sessions
const LAST_DIR_KEY = 'sw:lastDir'
function saveLastDir(dir: string) { localStorage.setItem(LAST_DIR_KEY, dir) }
function loadLastDir(): string | null { return localStorage.getItem(LAST_DIR_KEY) }

// ── Component ─────────────────────────────────────────────────────────────────

export default function FileBrowser({ isOpen, onClose, onOpenFile }: FileBrowserProps) {
  const [dir, setDir]       = useState<string>('')
  const [dirs, setDirs]     = useState<string[]>([])
  const [files, setFiles]   = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const newNameRef = useRef<HTMLInputElement>(null)

  // Fetch directory listing whenever dir changes (or modal opens)
  useEffect(() => {
    if (!isOpen) return
    const target = dir || loadLastDir() || ''
    browse(target)
  }, [isOpen, dir])

  async function browse(target: string) {
    setLoading(true)
    setError(null)
    try {
      const url = target ? `/api/browse?dir=${encodeURIComponent(target)}` : '/api/browse'
      const res = await fetch(url)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Browse failed')
      const data: { dir: string; dirs: string[]; files: string[] } = await res.json()
      setDir(data.dir)
      setDirs(data.dirs)
      setFiles(data.files)
      saveLastDir(data.dir)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load directory')
    } finally {
      setLoading(false)
    }
  }

  function openFile(filename: string) {
    onOpenFile(joinPath(dir, filename))
    onClose()
  }

  async function createFile() {
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('/api/document/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir, filename: name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not create file')
      setNewName('')
      onOpenFile(data.file)
      onClose()
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  // Show the last two path segments so the header doesn't overflow
  const displayPath = dir
    ? dir.split('/').slice(-2).join('/')
    : '…'

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-label="Open file"
        className="fixed z-50 inset-0 flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="pointer-events-auto w-full max-w-lg bg-white rounded-lg shadow-elevated flex flex-col max-h-[70vh]">

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
            {/* Back button */}
            {dir && dir !== parentDir(dir) && (
              <button
                onClick={() => setDir(parentDir(dir))}
                className="text-text-tertiary hover:text-text-secondary transition-colors duration-micro shrink-0"
                title="Go up one level"
                aria-label="Go up"
              >
                ←
              </button>
            )}
            <span className="flex-1 text-label font-medium text-text-tertiary truncate" title={dir}>
              {displayPath}
            </span>
            <button
              onClick={onClose}
              className="text-text-tertiary hover:text-text-secondary transition-colors duration-micro shrink-0"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <p className="text-body text-text-tertiary px-4 py-6 text-center">Loading…</p>
            )}
            {error && (
              <p className="text-body text-status-blocked px-4 py-4">{error}</p>
            )}
            {!loading && !error && dirs.length === 0 && files.length === 0 && (
              <p className="text-body text-text-tertiary px-4 py-6 text-center">No files found</p>
            )}
            {!loading && !error && (
              <ul>
                {dirs.map(d => (
                  <li key={d}>
                    <button
                      onClick={() => setDir(joinPath(dir, d))}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-subtle transition-colors duration-micro"
                    >
                      {/* Folder icon */}
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" className="shrink-0 text-text-tertiary" aria-hidden="true">
                        <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2H6a.5.5 0 0 1 .354.146L7.707 3.5H12.5A1.5 1.5 0 0 1 14 5v6a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 1 11V3.5Z" fill="currentColor" opacity=".3"/>
                        <path d="M2.5 2A1.5 1.5 0 0 0 1 3.5V11A1.5 1.5 0 0 0 2.5 12.5h10A1.5 1.5 0 0 0 14 11V5A1.5 1.5 0 0 0 12.5 3.5H7.707L6.354 2.146A.5.5 0 0 0 6 2H2.5Z" stroke="currentColor" strokeWidth="1" fill="none"/>
                      </svg>
                      <span className="text-body text-text-secondary">{d}</span>
                      <span className="ml-auto text-text-tertiary text-caption">›</span>
                    </button>
                  </li>
                ))}
                {files.map(f => (
                  <li key={f}>
                    <button
                      onClick={() => openFile(f)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-subtle transition-colors duration-micro"
                    >
                      {/* Document icon */}
                      <svg width="13" height="15" viewBox="0 0 13 15" fill="none" className="shrink-0 text-text-tertiary" aria-hidden="true">
                        <rect x="1" y="1" width="11" height="13" rx="1.5" stroke="currentColor" strokeWidth="1" fill="none"/>
                        <path d="M3.5 5h6M3.5 7.5h6M3.5 10h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                      </svg>
                      <span className="text-body text-text-primary">{f}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* New file footer */}
          <div className="border-t border-border px-4 py-3 shrink-0">
            {createError && (
              <p className="text-caption text-status-blocked mb-2">{createError}</p>
            )}
            <div className="flex gap-2">
              <input
                ref={newNameRef}
                value={newName}
                onChange={e => { setNewName(e.target.value); setCreateError(null) }}
                onKeyDown={e => { if (e.key === 'Enter') createFile() }}
                placeholder="New file name…"
                className="flex-1 text-body text-text-primary border border-border rounded-sm px-2.5 py-1.5 focus:outline-none focus:border-accent transition-colors duration-standard"
              />
              <button
                onClick={createFile}
                disabled={creating || !newName.trim()}
                className="text-label font-medium bg-accent text-white px-3 py-1.5 rounded-sm hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-micro"
              >
                {creating ? '…' : 'Create'}
              </button>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}

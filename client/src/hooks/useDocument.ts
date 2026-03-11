import { useState, useEffect, useCallback, useRef } from 'react'

// The shape of frontmatter we always read/write.
// Required fields are always present after the first GET.
export interface Frontmatter {
  title: string
  created: string
  modified: string
  author?: string
  status?: string
  tags?: string[]
  project?: string
  [key: string]: unknown
}

export interface DocumentState {
  frontmatter: Frontmatter
  body: string
  isLoading: boolean
  error: string | null
}

/**
 * Fetches a document from the server and exposes a save function.
 * The server handles frontmatter parsing (gray-matter) and modification
 * timestamp updates — the client just works with { frontmatter, body }.
 */
export function useDocument(filePath: string | null) {
  const [state, setState] = useState<DocumentState>({
    frontmatter: { title: '', created: '', modified: '' },
    body: '',
    isLoading: true,
    error: null,
  })

  // Becomes true when the server broadcasts that the file changed externally.
  // App.tsx watches this and shows a Toast with a Reload button.
  const [externalChanged, setExternalChanged] = useState(false)

  // Keep a ref so the save callback can always read the latest frontmatter
  // without becoming a stale closure.
  const frontmatterRef = useRef(state.frontmatter)
  frontmatterRef.current = state.frontmatter

  useEffect(() => {
    if (!filePath) {
      setState(s => ({ ...s, isLoading: false }))
      return
    }

    setState(s => ({ ...s, isLoading: true, error: null }))

    fetch(`/api/document?file=${encodeURIComponent(filePath)}`)
      .then(r => {
        if (!r.ok) throw new Error(`Server error ${r.status}`)
        return r.json()
      })
      .then(({ frontmatter, body }: { frontmatter: Frontmatter; body: string }) => {
        // Strip legacy <br /> tags (artifacts from other editors); treat as blank lines.
        const cleanBody = body.replace(/<br\s*\/?>\n?/gi, '\n')
        setState({ frontmatter, body: cleanBody, isLoading: false, error: null })
      })
      .catch(err => {
        setState(s => ({ ...s, isLoading: false, error: err.message }))
      })
  }, [filePath])

  // ── WebSocket live sync ─────────────────────────────────────────────────────
  // Connect once on mount; auto-reconnect with 3s backoff on disconnect.
  // The server broadcasts 'file:changed' when chokidar detects an external write.

  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    function connect() {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${proto}//${window.location.host}/ws`)

      ws.onmessage = (e) => {
        try {
          const { type } = JSON.parse(e.data as string)
          if (type === 'file:changed') setExternalChanged(true)
        } catch { /* ignore malformed messages */ }
      }

      ws.onclose = () => {
        if (!stopped) reconnectTimer = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      stopped = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, []) // connect once for the lifetime of the hook

  /**
   * Write the current editor markdown back to disk.
   * Merges any optional frontmatter overrides (e.g. updated title from H1 sync).
   * Server stamps modified timestamp — we update our local copy from the response.
   */
  const save = useCallback(async (markdown: string, fmOverrides?: Partial<Frontmatter>) => {
    if (!filePath) return
    const fm = { ...frontmatterRef.current, ...fmOverrides }

    const res = await fetch('/api/document', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: filePath, frontmatter: fm, body: markdown }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Save failed' }))
      throw new Error(err.error)
    }

    const { frontmatter: saved } = await res.json()
    setState(s => ({ ...s, frontmatter: saved }))
  }, [filePath])

  // Re-fetch the file from disk.
  // Does NOT set isLoading — we never want to flash a loading screen for a
  // background sync. The editor content just updates when the fetch arrives.
  const reload = useCallback(() => {
    if (!filePath) return
    setExternalChanged(false)

    fetch(`/api/document?file=${encodeURIComponent(filePath)}`)
      .then(r => {
        if (!r.ok) throw new Error(`Server error ${r.status}`)
        return r.json()
      })
      .then(({ frontmatter, body }: { frontmatter: Frontmatter; body: string }) => {
        const cleanBody = body.replace(/<br\s*\/?>\n?/gi, '\n')
        setState({ frontmatter, body: cleanBody, isLoading: false, error: null })
      })
      .catch(err => {
        setState(s => ({ ...s, error: err.message }))
      })
  }, [filePath])

  return { ...state, save, reload, externalChanged }
}

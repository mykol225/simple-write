import 'dotenv/config'
import { createServer } from 'http'
import { resolve, dirname } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'
import { WebSocketServer } from 'ws'
import chokidar from 'chokidar'
import matter from 'gray-matter'
import { readFile, writeFile, readdir } from 'fs/promises'
import Anthropic from '@anthropic-ai/sdk'

const app = express()
const PORT = parseInt(process.env.PORT || '3003', 10)

app.use(cors())
app.use(express.json())

// In production, serve the built Vite output
const __dirname = new URL('.', import.meta.url).pathname
app.use(express.static(resolve(__dirname, '../dist')))

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Ensure required frontmatter fields exist; fills defaults if missing. */
function ensureFrontmatter(data) {
  const now = new Date().toISOString()
  if (!data.title)   data.title   = 'Untitled'
  if (!data.created) data.created = now
  // modified is always refreshed on write, but seed it on first read if absent
  if (!data.modified) data.modified = now
  return data
}

/** Read a .md file and return { frontmatter, body, hadAllFields }.
 *  hadAllFields is true when the file already had title, created, and modified
 *  so callers know whether to write defaults back without an extra stat call. */
async function readDocument(filePath) {
  const raw = await readFile(filePath, 'utf8')
  const { data, content } = matter(raw)
  const hadAllFields = !!(data.title && data.created && data.modified)
  const frontmatter = ensureFrontmatter({ ...data })
  return { frontmatter, body: content, hadAllFields }
}

/** Serialize and write { frontmatter, body } back to disk. */
async function writeDocument(filePath, frontmatter, body) {
  const output = matter.stringify(body, frontmatter)
  await writeFile(filePath, output, 'utf8')
}

// ── API routes ────────────────────────────────────────────────────────────────

// GET /api/document?file=/abs/path/to/file.md
// Returns { frontmatter, body } — frontmatter is stripped from body.
// Auto-creates required frontmatter fields if missing on first open.
app.get('/api/document', async (req, res) => {
  const filePath = req.query.file
  if (!filePath) return res.status(400).json({ error: 'file query param is required' })

  try {
    const { frontmatter, body, hadAllFields } = await readDocument(filePath)

    // Only write back if the file was missing required frontmatter fields —
    // writing on every read would trigger chokidar on every GET, causing an
    // infinite reload loop when live sync is active.
    if (!hadAllFields) {
      markOwnWrite(filePath)
      await writeDocument(filePath, frontmatter, body)
    }

    // Update the file watcher to watch this file (for live sync in Phase 5)
    updateWatcher(filePath)

    res.json({ frontmatter, body })
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: `File not found: ${filePath}` })
    }
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/document
// Body: { file, frontmatter, body }
// Updates modified timestamp, serializes with gray-matter, writes to disk.
app.put('/api/document', async (req, res) => {
  const { file, frontmatter, body } = req.body
  if (!file)        return res.status(400).json({ error: 'file is required' })
  if (!frontmatter) return res.status(400).json({ error: 'frontmatter is required' })
  if (body == null) return res.status(400).json({ error: 'body is required' })

  try {
    // Always stamp modified on every save
    const updated = { ...frontmatter, modified: new Date().toISOString() }

    // Mark the next chokidar event as ours so live sync doesn't echo it back
    markOwnWrite(file)

    await writeDocument(file, updated, body)
    res.json({ frontmatter: updated })
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: `File not found: ${file}` })
    }
    res.status(500).json({ error: err.message })
  }
})

// GET /api/browse?dir=/abs/path
// Returns { dirs: [], files: [] } — .md files only; defaults to DATA_FILE's parent dir.
app.get('/api/browse', async (req, res) => {
  let dir = req.query.dir

  // Default to DATA_FILE's parent directory if set, else home dir
  if (!dir) {
    if (process.env.DATA_FILE) {
      dir = dirname(resolve(process.env.DATA_FILE))
    } else {
      dir = process.env.HOME || '/'
    }
  }

  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const dirs  = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name)
    const files = entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name)
    res.json({ dir, dirs, files })
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: `Directory not found: ${dir}` })
    }
    res.status(500).json({ error: err.message })
  }
})

// POST /api/document/new
// Body: { dir, filename }
// Creates a new .md file with minimal frontmatter; returns absolute path.
app.post('/api/document/new', async (req, res) => {
  const { dir, filename } = req.body
  if (!dir)      return res.status(400).json({ error: 'dir is required' })
  if (!filename) return res.status(400).json({ error: 'filename is required' })

  const name = filename.endsWith('.md') ? filename : `${filename}.md`
  const filePath = resolve(dir, name)

  // Don't overwrite an existing file
  if (existsSync(filePath)) {
    return res.status(409).json({ error: `File already exists: ${filePath}` })
  }

  const now = new Date().toISOString()
  const frontmatter = {
    title:    filename.replace(/\.md$/, ''),
    created:  now,
    modified: now,
  }

  try {
    // Ensure the directory exists
    mkdirSync(dir, { recursive: true })
    await writeDocument(filePath, frontmatter, '')
    res.status(201).json({ file: filePath, frontmatter })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/chat
// Returns { enabled: true } when ANTHROPIC_API_KEY is set.
// The client checks this on mount and only initialises the chat widget if true.
app.get('/api/chat', (_req, res) => {
  res.json({ enabled: !!process.env.ANTHROPIC_API_KEY })
})

// POST /api/chat
// Body: { messages: [{role, content}][], context: string }
// Streams the assistant reply token-by-token via SSE.
app.post('/api/chat', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured' })
  }

  const { messages = [], context = '' } = req.body

  // Build a system prompt from the plain-text context the client provides
  const system = [
    'You are a writing assistant embedded in Simple Write, a focused markdown editor.',
    'Help the user with their document — suggest edits, improve clarity, answer questions about the content.',
    '',
    context ? `── Context ──\n${context}\n── End of context ──` : '(no document context provided)',
    '',
    'Keep replies concise and practical. Use markdown formatting where helpful.',
  ].join('\n')

  // Set SSE headers before streaming begins
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')

  try {
    // ANTHROPIC_BASE_URL enables alternative providers (e.g. Databricks).
    // Falls back to the default Anthropic API if not set.
    const clientOpts = { apiKey: process.env.ANTHROPIC_API_KEY }
    if (process.env.ANTHROPIC_BASE_URL) clientOpts.baseURL = process.env.ANTHROPIC_BASE_URL
    const client = new Anthropic(clientOpts)

    const stream = client.messages.stream({
      model:      process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    })

    stream.on('text', (token) => {
      res.write(`data: ${JSON.stringify({ token })}\n\n`)
    })

    await stream.finalMessage()
    res.write('data: [DONE]\n\n')
    res.end()

  } catch (err) {
    // If headers haven't been sent yet, send a JSON error; otherwise stream it
    if (!res.headersSent) {
      return res.status(500).json({ error: err.message })
    }
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

// ── GET /api/health ───────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ ok: true, port: PORT }))

// ── POST /api/reveal ──────────────────────────────────────────────────────
// Reveals a file or folder in macOS Finder using `open -R <path>`.
app.post('/api/reveal', (req, res) => {
  const { path: targetPath } = req.body
  if (!targetPath || typeof targetPath !== 'string') {
    return res.status(400).json({ error: 'path is required' })
  }
  const child = spawn('open', ['-R', targetPath], { detached: true, stdio: 'ignore' })
  child.unref()
  res.json({ ok: true })
})

// ── POST /api/feedback ────────────────────────────────────────────────────
// Saves feedback JSON to feedback/YYYY-MM-DD-HH-MM-SS.json and, for urgent
// signals (urgency 1–4), spawns the triage agent asynchronously.
app.post('/api/feedback', (req, res) => {
  const { urgency, comment, app: appName, url, selectedText, pickedElement, appContext } = req.body

  const now      = new Date()
  const stamp    = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const feedDir  = resolve(dirname(fileURLToPath(import.meta.url)), '../feedback')
  const feedFile = resolve(feedDir, `${stamp}.json`)

  const isUrgent = urgency !== null && urgency !== undefined && urgency <= 4
  const record   = {
    timestamp:    now.toISOString(),
    app:          appName ?? 'Simple Write',
    urgency:      urgency ?? null,
    comment:      comment ?? '',
    url:          url ?? '',
    selectedText: selectedText ?? '',
    pickedElement: pickedElement ?? null,
    appContext:   appContext ?? {},
    status:       isUrgent ? 'pending' : 'analytics',
  }

  try {
    mkdirSync(feedDir, { recursive: true })
    writeFileSync(feedFile, JSON.stringify(record, null, 2))
  } catch (err) {
    console.error('Failed to write feedback:', err)
    return res.status(500).json({ ok: false })
  }

  res.json({ ok: true })

  // Spawn triage agent asynchronously for urgent feedback — fire and forget
  if (isUrgent) {
    const triageScript = resolve(dirname(fileURLToPath(import.meta.url)), '../../simple-shared/scripts/triage.js')
    const child = spawn('node', [triageScript, feedFile], { detached: true, stdio: 'ignore' })
    child.unref()
  }
})

// Fallback — SPA route for production
app.get('*', (_req, res) => {
  const indexPath = resolve(__dirname, '../dist/index.html')
  if (existsSync(indexPath)) {
    res.sendFile(indexPath)
  } else {
    res.status(404).send('Not found — run `npm run build` first')
  }
})

// ── HTTP + WebSocket server ───────────────────────────────────────────────────

const server = createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

/** Broadcast a message to all connected clients. */
function broadcast(message) {
  const data = JSON.stringify(message)
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(data)
  }
}

// ── Live sync ─────────────────────────────────────────────────────────────────

// Track the currently-watched file and our own write timestamps.
// We suppress external-change notifications triggered by our own autosave.
let _watcher = null
let _watchedFile = null

// Set of timestamps (ms) when we triggered a write; cleared after debounce window.
const _ownWrites = new Set()
const OWN_WRITE_WINDOW_MS = 2000  // 2s window to match autosave debounce

function markOwnWrite(filePath) {
  if (filePath !== _watchedFile) return
  const ts = Date.now()
  _ownWrites.add(ts)
  setTimeout(() => _ownWrites.delete(ts), OWN_WRITE_WINDOW_MS)
}

function isOwnWrite() {
  // If any own-write timestamp is within the window, this is our change
  return _ownWrites.size > 0
}

/** Start watching a new file; stop watching the previous one. */
function updateWatcher(filePath) {
  if (_watchedFile === filePath) return  // already watching this file

  if (_watcher) {
    _watcher.close()
    _watcher = null
  }

  _watchedFile = filePath

  _watcher = chokidar.watch(filePath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
  })

  _watcher.on('change', async (path) => {
    // Suppress echoes of our own autosave writes
    if (isOwnWrite()) return

    try {
      const content = await readFile(path, 'utf8')
      broadcast({ type: 'file:changed', content })
    } catch { /* file may have been deleted — ignore */ }
  })

  _watcher.on('unlink', () => {
    broadcast({ type: 'file:deleted' })
  })
}

server.listen(PORT, () => {
  console.log(`Simple Write running at http://localhost:${PORT}`)
  if (process.env.DATA_FILE) {
    console.log(`Default file: ${process.env.DATA_FILE}`)
  }
})

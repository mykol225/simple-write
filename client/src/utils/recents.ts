// Recent files — persisted to localStorage so the Landing page can show
// a "pick up where you left off" list across sessions.

export interface RecentFile {
  path: string
  title: string
  modified: string
}

const KEY = 'sw:recentFiles'
const MAX = 10

export function getRecents(): RecentFile[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function addToRecents(file: RecentFile): void {
  // Dedupe by path, newest first, capped at MAX entries
  const next = [file, ...getRecents().filter(f => f.path !== file.path)].slice(0, MAX)
  localStorage.setItem(KEY, JSON.stringify(next))
}

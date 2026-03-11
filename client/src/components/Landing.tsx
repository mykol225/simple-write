import { useState } from 'react'
import FileBrowser from './FileBrowser'
import { getRecents } from '../utils/recents'
import type { RecentFile } from '../utils/recents'

interface LandingProps {
  onOpenFile: (path: string) => void
}

function formatDate(iso: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return '' }
}

export default function Landing({ onOpenFile }: LandingProps) {
  const [browserOpen, setBrowserOpen] = useState(false)
  const recents: RecentFile[] = getRecents()

  return (
    <div className="h-full flex flex-col items-center justify-center bg-surface-page px-6">

      {/* Wordmark */}
      <div className="flex items-baseline gap-2 mb-10">
        <h1 className="text-heading font-bold text-text-primary">Simple Write</h1>
        <span className="text-label font-medium text-text-tertiary">0.5</span>
        <span className="text-caption font-medium bg-accent-light text-accent px-1.5 py-0.5 rounded-full">Alpha</span>
      </div>

      {/* Primary CTAs */}
      <div className="flex gap-3 mb-10">
        <button
          onClick={() => setBrowserOpen(true)}
          className="flex items-center gap-2 text-body font-medium bg-accent text-white px-5 py-2 rounded-md hover:bg-accent-hover transition-colors duration-micro"
        >
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path d="M2.5 2A1.5 1.5 0 0 0 1 3.5V11A1.5 1.5 0 0 0 2.5 12.5h10A1.5 1.5 0 0 0 14 11V5A1.5 1.5 0 0 0 12.5 3.5H7.707L6.354 2.146A.5.5 0 0 0 6 2H2.5Z" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          </svg>
          Open file
        </button>

        <button
          onClick={() => setBrowserOpen(true)}
          className="flex items-center gap-2 text-body font-medium border border-border text-text-secondary bg-white px-5 py-2 rounded-md hover:bg-surface-subtle transition-colors duration-micro"
        >
          <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path d="M7.5 2v11M2 7.5h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          New document
        </button>
      </div>

      {/* Recent files */}
      {recents.length > 0 && (
        <div className="w-full max-w-sm">
          <p className="text-caption font-medium text-text-tertiary uppercase tracking-wide mb-3">
            Recent
          </p>
          <ul className="flex flex-col gap-1">
            {recents.map(f => (
              <li key={f.path}>
                <button
                  onClick={() => onOpenFile(f.path)}
                  className="w-full flex items-center justify-between gap-4 px-3 py-2 rounded-md text-left hover:bg-white hover:shadow-subtle transition-all duration-micro"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <svg width="12" height="13" viewBox="0 0 13 15" fill="none" className="shrink-0 text-text-placeholder" aria-hidden="true">
                      <rect x="1" y="1" width="11" height="13" rx="1.5" stroke="currentColor" strokeWidth="1" fill="none"/>
                      <path d="M3.5 5h6M3.5 7.5h6M3.5 10h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    </svg>
                    <span className="text-body text-text-primary truncate">
                      {f.title || f.path.split('/').pop()}
                    </span>
                  </div>
                  <span className="text-caption text-text-tertiary shrink-0">
                    {formatDate(f.modified)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FileBrowser
        isOpen={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onOpenFile={onOpenFile}
      />
    </div>
  )
}

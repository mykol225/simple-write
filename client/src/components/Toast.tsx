import { useEffect } from 'react'

export interface ToastData {
  message: string
  /** Optional action button — when present the toast does NOT auto-dismiss. */
  action?: { label: string; onClick: () => void }
}

interface ToastProps extends ToastData {
  onDismiss: () => void
}

export default function Toast({ message, action, onDismiss }: ToastProps) {
  // Auto-dismiss after 4s only when there is no action button
  useEffect(() => {
    if (action) return
    const t = setTimeout(onDismiss, 4000)
    return () => clearTimeout(t)
  }, [action, onDismiss])

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-2.5 rounded-md animate-fade-in"
      style={{ background: '#111827', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
      role="status"
      aria-live="polite"
    >
      <span className="text-label text-white">{message}</span>

      {action && (
        <button
          onClick={action.onClick}
          className="text-label font-medium text-accent-light hover:text-white transition-colors duration-micro shrink-0"
        >
          {action.label}
        </button>
      )}

      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-label text-white/50 hover:text-white transition-colors duration-micro ml-1"
      >
        ✕
      </button>
    </div>
  )
}

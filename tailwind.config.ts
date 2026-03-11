import type { Config } from 'tailwindcss'

// Shared design token system for Simple Views series.
// All values are drawn from patterns found in Simple Kanban and Simple Roadmap.
// This config is the canonical reference — future views should copy these tokens.

export default {
  content: ['./client/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ── Type Scale ──────────────────────────────────────────────────────
      // 6-step scale from 11px (caption) to 20px (document H1)
      fontSize: {
        'caption':  ['11px', { lineHeight: '1.4' }],  // labels, column headers, timestamps
        'label':    ['12px', { lineHeight: '1.4' }],  // badges, meta fields, secondary UI
        'body':     ['13px', { lineHeight: '1.5' }],  // base text, most UI copy
        'subtitle': ['14px', { lineHeight: '1.4' }],  // card titles, section names
        'title':    ['16px', { lineHeight: '1.3' }],  // panel headers, drawer titles
        'heading':  ['20px', { lineHeight: '1.2' }],  // document H1 (in-editor)
      },

      // ── Color Palette ───────────────────────────────────────────────────
      // Rationalized from both existing projects; consistent surface + text + accent
      colors: {
        // Surfaces and borders
        surface: {
          DEFAULT: '#ffffff',    // primary surface
          page:    '#F9FAFB',    // page background
          subtle:  '#F3F4F6',    // subtle fills, hover states
        },
        border: {
          DEFAULT:  '#E5E7EB',   // default borders
          emphasis: '#D1D5DB',   // emphasized borders, focused inputs
        },
        // Text hierarchy
        text: {
          primary:     '#111827',  // headings, labels, primary UI
          secondary:   '#374151',  // body text, descriptions
          tertiary:    '#6B7280',  // meta, timestamps, save indicator
          placeholder: '#9CA3AF',  // disabled states, editor placeholder
        },
        // Accent — indigo for interactive elements, tags, active states
        accent: {
          DEFAULT: '#6366F1',       // indigo-500
          light:   '#EEF2FF',       // indigo-50, tag backgrounds
          hover:   '#4F46E5',       // indigo-600, hover states
        },
        // Status colors — shared across all Simple Views
        status: {
          draft:      '#9CA3AF',   // not started / draft (gray-400)
          inprogress: '#3B82F6',   // in progress / review (blue-500)
          done:       '#22C55E',   // done / published (green-500)
          blocked:    '#EF4444',   // blocked (red-500)
        },
      },

      // ── Spacing — 4px base grid ─────────────────────────────────────────
      // Tailwind already has these via its default scale (1=4px, 2=8px, etc.)
      // No custom additions needed; use standard classes: p-1, p-2, p-3...

      // ── Border Radius ───────────────────────────────────────────────────
      borderRadius: {
        'sm':   '6px',    // inputs, small buttons, inline elements
        'md':   '8px',    // cards, dropdowns, medium containers
        'lg':   '12px',   // panels, modals, large containers
        'full': '9999px', // pills, badges, tags
      },

      // ── Shadows ─────────────────────────────────────────────────────────
      // 3-level system: subtle → medium → elevated
      boxShadow: {
        'subtle':   '0 1px 2px rgba(0,0,0,0.05)',    // cards, resting surfaces
        'medium':   '0 4px 12px rgba(0,0,0,0.10)',   // dropdowns, floating elements
        'elevated': '0 12px 32px rgba(0,0,0,0.15)',  // modals, overlays
        'toast':    '0 4px 12px rgba(0,0,0,0.10)',   // toast notifications
      },

      // ── Transitions ─────────────────────────────────────────────────────
      // 3-tier timing: micro (hover) → standard (state changes) → enter (panels)
      transitionDuration: {
        'micro':    '100',  // hover fills, icon swaps
        'standard': '150',  // panel visibility, color changes
        'enter':    '200',  // slide-in drawers, modals
      },

      // ── Typography (Prose) ──────────────────────────────────────────────
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', 'monospace'],
      },

      // ── Animations ──────────────────────────────────────────────────────
      keyframes: {
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'fade-in':  { from: { opacity: '0' },                  to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' },                  to: { opacity: '0' } },
      },
      animation: {
        'slide-in': 'slide-in 200ms ease-out',
        'fade-in':  'fade-in 150ms ease-out',
        'fade-out': 'fade-out 150ms ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config

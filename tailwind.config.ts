import type { Config } from 'tailwindcss'
import { sharedTheme } from '../simple-shared/tailwind.base'

export default {
  content: ['./client/src/**/*.{ts,tsx}'],
  theme: sharedTheme,
  plugins: [],
} satisfies Config

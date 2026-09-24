import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Tauri runs the dev server itself; keep its output readable.
  clearScreen: false,
  server: {
    // Pinned so the launcher shortcut and the Tauri devUrl cannot drift onto
    // 5174, which would also silently create a separate browser database.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})

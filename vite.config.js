import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          copc: ['copc'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['copc', 'three'],
  },
  server: {
    headers: {
      // Needed for SharedArrayBuffer if using WASM threads
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
})

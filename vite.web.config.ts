import { statSync, copyFileSync, existsSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import pkg from './package.json'

export default defineConfig({
  base: './',
  define: {
    'process.env': {},
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(statSync('src/renderer/i18n/locales/english.json').mtime.toISOString()),
  },
  resolve: {
    alias: {
      lzma: '/src/web/lzma-browser.ts',
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-i18next',
      'i18next',
      'lucide-react',
      'recharts',
      'date-fns',
      'xz-decompress',
      'fflate',
    ],
  },
  plugins: [
    {
      name: 'serve-web-html',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/' || req.url === '') {
            req.url = '/index.web.html'
          }
          next()
        })
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/' || req.url === '') {
            req.url = '/index.web.html'
          }
          next()
        })
      },
      closeBundle() {
        if (existsSync('dist-web/index.web.html')) {
          copyFileSync('dist-web/index.web.html', 'dist-web/index.html')
        }
      },
    },
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist-web',
    target: 'esnext',
    rollupOptions: {
      input: {
        main: './index.web.html',
      },
    },
  },
  esbuild: {
    target: 'esnext',
  },
})

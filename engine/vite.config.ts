import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { examplesPlugin } from './src/node/preview-plugins.ts'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// The runtime page lives in src/runtime. Bundled fonts in engine/assets are served from the web
// root (e.g. /fonts/cairo/Cairo-Variable.ttf), which works in dev and when the renderer starts
// Vite programmatically with this config file.
export default defineConfig({
  root: here('./src/runtime'),
  publicDir: here('./assets'),
  server: { fs: { allow: [here('./src'), here('./assets'), here('./node_modules')] } },
  plugins: [examplesPlugin()],
  clearScreen: false,
})

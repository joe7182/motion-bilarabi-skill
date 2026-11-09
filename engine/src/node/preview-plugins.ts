import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const EXAMPLES = fileURLToPath(new URL('../../examples', import.meta.url))

/** Serves engine/examples/*.json at /examples/* (the dir is outside the Vite root). */
export function examplesPlugin(): Plugin {
  return {
    name: 'mba-examples',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]!
        if (!url.startsWith('/examples/')) return next()
        let rel: string
        try {
          rel = decodeURIComponent(url.slice('/examples/'.length))
        } catch {
          return next()
        }
        const file = resolve(EXAMPLES, rel)
        if (!file.startsWith(EXAMPLES + sep) || extname(file) !== '.json') return next()
        try {
          const data = await readFile(file)
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(data)
        } catch {
          next()
        }
      })
    },
  }
}

/** Serves the storyboard given to `mba preview` at /__sb.json, re-read on every request. */
export function storyboardPlugin(load: () => Promise<{ json: unknown }>): Plugin {
  return {
    name: 'mba-storyboard',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url ?? '').split('?')[0] !== '/__sb.json') return next()
        try {
          const { json } = await load()
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-store')
          res.end(JSON.stringify(json))
        } catch (e) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end(e instanceof Error ? e.message : String(e))
        }
      })
    },
  }
}

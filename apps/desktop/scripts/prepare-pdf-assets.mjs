import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { cpSync, mkdirSync } from 'node:fs'
const require = createRequire(import.meta.url)
const source = dirname(require.resolve('pdfjs-dist/package.json'))
const target = resolve(import.meta.dirname, '../src/renderer/public/pdf-assets')
mkdirSync(target, { recursive: true })
for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs', 'LICENSE']) cpSync(resolve(source, name), resolve(target, name), { recursive: true })

import { defineConfig } from 'electron-vite'
export default defineConfig({
  main: {},
  preload: {},
  renderer: { build: { rolldownOptions: { output: { format: 'es' } } } }
})

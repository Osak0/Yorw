import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import type { Backend } from './backend'

/** Packaged-app smoke for generic imports and the structured reader. */
export async function runMultiFormatSmoke(window: BrowserWindow, backend: Backend, reportDir: string) {
  const upload = async (name: string) => {
    const bytes = await readFile(join(reportDir, name))
    const form = new FormData()
    form.append('file', new Blob([bytes]), name)
    return backend.request('/v1/documents/import', 'POST', form)
  }
  await upload('fixture.docx')
  await upload('fixture.md')
  await upload('fixture.txt')
  const deadline = Date.now() + 30000
  let documents: any = { items: [] }
  while (Date.now() < deadline) {
    documents = await backend.request('/v1/documents')
    const wanted = documents.items.filter((item: any) => ['fixture.docx', 'fixture.md', 'fixture.txt'].includes(item.original_name))
    if (wanted.length === 3 && wanted.every((item: any) => ['ready', 'partial'].includes(item.extraction_status))) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  for (const name of ['fixture.docx', 'fixture.md', 'fixture.txt']) {
    const item = documents.items.find((value: any) => value.original_name === name)
    if (!item || !['ready', 'partial'].includes(item.extraction_status)) throw new Error(`MULTIFORMAT_PARSE_MISSING:${name}`)
  }
  return window.webContents.executeJavaScript(`(async () => {
    const waitFor = async (predicate, label) => {
      const end = Date.now() + 15000
      while (Date.now() < end) { if (predicate()) return true; await new Promise(resolve => setTimeout(resolve, 100)) }
      throw new Error(label)
    }
    const button = text => [...document.querySelectorAll('button')].find(element => element.textContent === text)
    const open = async (fileName, expected, requireToc = true) => {
      const row = await (async () => {
        await waitFor(() => [...document.querySelectorAll('.document-row')].some(element => element.textContent.includes(fileName)), 'ROW_MISSING:' + fileName)
        return [...document.querySelectorAll('.document-row')].find(element => element.textContent.includes(fileName))
      })()
      const openButton = [...row.querySelectorAll('button')].find(element => element.textContent === '打开阅读')
      openButton.click()
      await waitFor(() => !!document.querySelector('.structured-reader'), 'STRUCTURED_MISSING:' + fileName)
      const text = document.querySelector('.structured-content')?.textContent ?? ''
      if (!expected.every(value => text.includes(value))) throw new Error('CONTENT_MISSING:' + fileName)
      const toc = [...document.querySelectorAll('.structured-toc button')].map(element => element.textContent)
      let highlighted = false
      if (requireToc) {
        if (!toc.length) throw new Error('TOC_MISSING:' + fileName)
        document.querySelector('.structured-toc button').click()
        await new Promise(resolve => setTimeout(resolve, 350))
        highlighted = !!document.querySelector('.structured-highlight')
      }
      button('返回文献库')?.click()
      await waitFor(() => [...document.querySelectorAll('.document-row')].some(element => element.textContent.includes(fileName)), 'LIBRARY_RETURN:' + fileName)
      return { title: fileName, toc, highlighted }
    }
    const docx = await open('fixture.docx', ['Methods', 'Recall', 'self-written DOCX fixture'])
    const md = await open('fixture.md', ['Fixture Markdown', 'Methods', 'Metric'])
    const txt = await open('fixture.txt', ['Fixture TXT', 'plain text fixture'], false)
    return { docx, md, txt }
  })()`)
}

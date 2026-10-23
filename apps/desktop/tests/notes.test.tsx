import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test, vi } from 'vitest'
import { MarkdownPreview } from '../src/renderer/MarkdownPreview'
import { Notes } from '../src/main/notes'
import type { Backend } from '../src/main/backend'

test('preview renders Markdown without scripts, raw HTML, image requests or active links', () => {
  const html = renderToStaticMarkup(<MarkdownPreview body={'# 我的理解\n\n**evidence**\n\n<script>alert(1)</script>\n\n<img src="https://example.com/leak">\n\n![alt](https://example.com/leak)\n\n[run](javascript:alert%281%29)\n\n| A | B |\n| - | - |\n| 1 | 2 |'} />)
  expect(html).toContain('<h1>我的理解</h1>')
  expect(html).toContain('<strong>evidence</strong>')
  expect(html).toContain('<table>')
  expect(html).not.toMatch(/<script|<img|<a\s|src=|href=/)
})

test('notes bridge rejects paths and invalid bodies/versions and forwards only explicit fields', async () => {
  const request = vi.fn(async () => ({}))
  const notes = new Notes({ request } as unknown as Backend)
  const id = '12345678-1234-1234-1234-123456789abc'
  expect(() => notes.list('../outside')).toThrow('INVALID_INPUT')
  const value = { id, document_id: id, body_md: 'my note', version: 0 }
  expect(() => notes.save({ ...value, version: .5 })).toThrow('INVALID_INPUT')
  expect(() => notes.save({ ...value, body_md: 'x'.repeat(200_001) })).toThrow('INVALID_INPUT')
  await notes.save(value)
  expect(request).toHaveBeenLastCalledWith('/v1/notes', 'POST', { id, document_id: id, body_md: 'my note' })
  await notes.save({ ...value, version: 2 })
  expect(request).toHaveBeenLastCalledWith(`/v1/notes/${id}`, 'PATCH', { version: 2, body_md: 'my note' })
})

import { vi, expect, test } from 'vitest'
vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }))
import { dialog } from 'electron'
import { Documents } from '../src/main/documents'
import type { Backend } from '../src/main/backend'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('native cancellation never uploads; selection uploads only selected bytes, never renderer paths', async () => {
  const request = vi.fn(async (_path: string, _method: string, _body?: unknown) => ({ deduplicated: false }))
  const documents = new Documents({ request } as unknown as Backend)
  vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
  expect(await documents.importPdf()).toEqual({ cancelled: true })
  expect(request).not.toHaveBeenCalled()
  const directory = await mkdtemp(join(tmpdir(), 'yorw-pdf-test-'))
  try {
    const path = join(directory, 'fixture.pdf')
    await writeFile(path, '%PDF-1.7 fixture')
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [path] })
    await documents.importPdf()
    const form = request.mock.calls[0][2] as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(await (form.get('file') as File).text()).toBe('%PDF-1.7 fixture')
    expect((form.get('file') as File).name).toBe('fixture.pdf')
  } finally { await rm(directory, { recursive: true, force: true }) }
})


test('PDF bridge accepts IDs and positive integer pages only', async () => {
  const readPdf = vi.fn(async () => new Uint8Array([37,80,68,70]))
  const request = vi.fn(async () => ({ page: 2 }))
  const documents = new Documents({ readPdf, request } as unknown as Backend)
  expect(() => documents.readPdf('../outside.pdf')).toThrow('INVALID_INPUT')
  expect(() => documents.savePosition({ id: 'invalid', page: 1 })).toThrow('INVALID_INPUT')
  expect(() => documents.savePosition({ id: '12345678-1234-1234-1234-123456789abc', page: 0 })).toThrow('INVALID_PAGE')
  const identity = '12345678-1234-1234-1234-123456789abc'
  expect(await documents.readPdf(identity)).toEqual(new Uint8Array([37,80,68,70]))
  await documents.savePosition({ id: identity, page: 2 })
  expect(request).toHaveBeenCalledWith(`/v1/documents/${identity}/position`, 'PATCH', { page: 2 })
})

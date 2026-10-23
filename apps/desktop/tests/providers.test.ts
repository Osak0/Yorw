import { vi, expect, test } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
vi.mock('electron', () => ({ safeStorage: { isAsyncEncryptionAvailable: vi.fn(async () => true), encryptStringAsync: async (value: string) => Buffer.from('encrypted:' + value.split('').reverse().join('')), decryptStringAsync: async (value: Buffer) => ({ result: value.toString().slice(10).split('').reverse().join(''), shouldReEncrypt: false }) } }))
import { safeStorage } from 'electron'
import { Providers } from '../src/main/providers'
import type { Backend } from '../src/main/backend'

test('save uses ciphertext, does not return key, preserves key, and clears it explicitly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yorw-keys-'))
  let items: any[] = []
  const backend = { request: vi.fn(async (_path, method, body) => {
    if (method === 'PUT') { items = [{ ...body, kind: 'chat', version: body.version + 1 }]; return items[0] }
    return { items }
  }) } as unknown as Backend
  try {
    const providers = new Providers(backend, directory)
    const config = { kind: 'chat' as const, base_url: 'https://api.deepseek.com', model: 'deepseek-flash', version: 0, key: 'fixture-secret' }
    const saved = await providers.save(config)
    expect(saved.has_key).toBe(true)
    expect(JSON.stringify(saved)).not.toContain('fixture-secret')
    expect((await readFile(join(directory, 'chat-1.enc'))).toString()).not.toContain('fixture-secret')
    const updated = await providers.save({ ...saved, key: '' })
    expect(updated.has_key).toBe(true)
    const cleared = await providers.save({ ...updated, clear_key: true })
    expect(cleared.has_key).toBe(false)
    await expect(providers.save(config)).rejects.toThrow('CONFIG_CONFLICT')
    vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(false)
    await expect(providers.save({ ...cleared, key: 'new-secret' })).rejects.toThrow('SECURE_STORAGE_UNAVAILABLE')
  } finally { vi.mocked(safeStorage.isAsyncEncryptionAvailable).mockResolvedValue(true); await rm(directory, { recursive: true, force: true }) }
})

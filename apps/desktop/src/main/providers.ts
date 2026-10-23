import { safeStorage } from 'electron'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Backend } from './backend'
import type { ProviderConfig, ProviderInput, ProviderKind } from '../shared/status'

export class Providers {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private backend: Backend, private directory: string) {}
  private path(kind: ProviderKind, version: number) { return join(this.directory, `${kind}-${version}.enc`) }
  private async key(config: ProviderConfig): Promise<string> {
    try {
      const data = await readFile(this.path(config.kind, config.version))
      if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('SECURE_STORAGE_UNAVAILABLE')
      return (await safeStorage.decryptStringAsync(data)).result
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
      throw new Error('KEY_UNAVAILABLE')
    }
  }
  async list(): Promise<ProviderConfig[]> {
    const result = await this.backend.request('/v1/providers')
    return Promise.all(result.items.map(async (config: ProviderConfig) => {
      try { return { ...config, has_key: !!(await this.key(config)) } }
      catch { return { ...config, has_key: false, key_error: true } }
    }))
  }
  save(input: ProviderInput): Promise<ProviderConfig> {
    const job = this.queue.catch(() => {}).then(() => this.saveOne(input))
    this.queue = job
    return job
  }
  private async saveOne(input: ProviderInput): Promise<ProviderConfig> {
    if (!input || !['chat', 'embedding'].includes(input.kind) || !Number.isInteger(input.version) || input.version < 0 || typeof input.base_url !== 'string' || typeof input.model !== 'string' || (input.key !== undefined && typeof input.key !== 'string') || (input.key?.length ?? 0) > 8192 || /[\r\n]/.test(input.key ?? '')) throw new Error('INVALID_CONFIG')
    const configs = (await this.backend.request('/v1/providers')).items as ProviderConfig[]
    const old = configs.find(config => config.kind === input.kind)
    if ((old?.version ?? 0) !== input.version) throw new Error('CONFIG_CONFLICT')
    if (old && old.base_url !== input.base_url.replace(/\/$/, '') && !input.clear_key && !input.key) throw new Error('KEY_REENTRY_REQUIRED')
    const key = input.clear_key ? '' : input.key || (old ? await this.key(old) : '')
    const target = this.path(input.kind, input.version + 1)
    const temp = join(this.directory, randomUUID() + '.tmp')
    if (key) {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('SECURE_STORAGE_UNAVAILABLE')
      await mkdir(this.directory, { recursive: true })
      try { await writeFile(temp, await safeStorage.encryptStringAsync(key), { flag: 'wx' }); await rename(temp, target) }
      finally { await unlink(temp).catch(() => {}) }
    }
    if (!key) await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error })
    try {
      const saved = await this.backend.request(`/v1/providers/${input.kind}`, 'PUT', { base_url: input.base_url, model: input.model, version: input.version })
      // Old ciphertext is retained until new configuration has committed.
      if (old) await unlink(this.path(old.kind, old.version)).catch(() => {})
      return { ...saved, has_key: !!key }
    } catch (error) {
      // Keep the new ciphertext on uncertain network failures: the DB may have committed.
      // A subsequent list resolves the committed version; orphan ciphertext never becomes active.
      throw error
    }
  }
  test(kind: ProviderKind) {
    const job = this.queue.catch(() => {}).then(() => this.testOne(kind))
    this.queue = job
    return job
  }
  // Main-process only: credentials go directly to the private service, never renderer.
  async embeddingCredentials() {
    await this.queue.catch(() => {})
    const config = (await this.backend.request('/v1/providers')).items.find((item: ProviderConfig) => item.kind === 'embedding') as ProviderConfig | undefined
    if (!config) return { version: 0, key: '' }
    return { version: config.version, key: await this.key(config).catch(() => '') }
  }
  private async testOne(kind: ProviderKind) {
    if (!['chat', 'embedding'].includes(kind)) throw new Error('INVALID_CONFIG')
    const config = (await this.backend.request('/v1/providers')).items.find((item: ProviderConfig) => item.kind === kind)
    if (!config) return { ok: false, code: 'CONFIG_MISSING' }
    return this.backend.request(`/v1/providers/${kind}/test`, 'POST', {}, await this.key(config))
  }
}

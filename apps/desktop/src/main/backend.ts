import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { AppStatus } from '../shared/status'

export class Backend {
  private child?: ChildProcessWithoutNullStreams
  private token = randomBytes(32).toString('hex')
  private port = 0
  private stopping = false
  status: AppStatus = { state: 'starting', message: '正在启动本地服务' }
  constructor(private command: string, private args: string[], private cwd: string, private workspacePath?: string) {}
  async start(): Promise<void> {
    if (this.stopping) return
    try {
      const child = this.child = spawn(this.command, this.args, { cwd: this.cwd, windowsHide: true, stdio: 'pipe' })
      child.stderr.resume() // Never copy unfiltered backend output into application logs.
      child.stdin.on('error', () => {})
      child.on('exit', () => { if (!this.stopping) this.status = { state: 'failed', message: '本地服务已退出，请重新打开知栖' } })
      await new Promise<void>((resolve, reject) => {
        let buffer = ''
        const timer = setTimeout(() => reject(new Error('START_TIMEOUT')), 15000)
        const fail = () => { clearTimeout(timer); reject(new Error('START_FAILED')) }
        child.once('error', fail)
        child.once('exit', fail)
        child.stdout.on('data', (data: Buffer) => {
          buffer += data.toString()
          if (buffer.length > 4096) return fail()
          if (!buffer.includes('\n')) return
          try {
            const event = JSON.parse(buffer.split('\n')[0])
            if (event.type === 'startup_error' && ['DATABASE_TOO_NEW', 'MIGRATION_FILES_INVALID', 'MIGRATION_HISTORY_INVALID', 'MIGRATION_CHECKSUM_CHANGED', 'UNKNOWN_DATABASE', 'DATABASE_INTEGRITY_FAILED', 'DATABASE_FOREIGN_KEYS_FAILED', 'MIGRATION_BACKUP_FAILED', 'MIGRATION_SQL_INCOMPLETE', 'WORKSPACE_OPEN_FAILED'].includes(event.code)) {
              clearTimeout(timer); reject(new Error(event.code)); return
            }
            if (event.type !== 'listening' || !Number.isInteger(event.port) || event.port < 1 || event.port > 65535) return fail()
            this.port = event.port
            clearTimeout(timer)
            resolve()
          } catch { fail() }
        })
        child.stdin.write(JSON.stringify({ token: this.token, workspace_path: this.workspacePath }) + '\n')
      })
      const deadline = Date.now() + 10000
      while (Date.now() < deadline && !this.stopping) {
        try {
          const response = await fetch(`http://127.0.0.1:${this.port}/v1/health`, { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(1000) })
          const health = await response.json()
          if (response.ok && health.ready && health.api_version === '1') {
            this.status = { state: 'ready', message: '本地服务已连接' }
            return
          }
        } catch { /* Socket may be bound before Uvicorn finishes startup. */ }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('HEALTH_TIMEOUT')
    } catch (error) {
      const code = error instanceof Error && /^(START_TIMEOUT|START_FAILED|HEALTH_TIMEOUT|DATABASE_[A-Z_]+|MIGRATION_[A-Z_]+|WORKSPACE_OPEN_FAILED|UNKNOWN_DATABASE)$/.test(error.message) ? error.message : 'SPAWN_FAILED'
      this.status = { state: 'failed', code, message: `本地服务启动失败（${code}），请检查安装完整性后重新打开知栖` }
      await this.stop()
    }
  }
  async request(path: string, method = 'GET', body?: unknown, key?: string): Promise<any> {
    if (this.status.state !== 'ready') throw new Error('BACKEND_NOT_READY')
    const response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'X-Provider-Key': key } : {}) },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(20000)
    })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(typeof data?.error?.code === 'string' && /^[A-Z_]+$/.test(data.error.code) ? data.error.code : 'BACKEND_ERROR')
    }
    return response.json()
  }
  async readPdf(identity: string): Promise<Uint8Array> {
    if (this.status.state !== 'ready') throw new Error('BACKEND_NOT_READY')
    const response = await fetch(`http://127.0.0.1:${this.port}/v1/documents/${identity}/file`, {
      headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(20000)
    })
    if (!response.ok) throw new Error(response.status === 404 ? 'DOCUMENT_FILE_MISSING' : 'BACKEND_ERROR')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > 50 * 1024 * 1024) throw new Error('PDF_TOO_LARGE')
    return bytes
  }
  async stop(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill() }, 3000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.stdin.end('shutdown\n')
    })
  }
}

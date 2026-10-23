import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { AppStatus } from '../shared/status'

export class Backend {
  private child?: ChildProcessWithoutNullStreams
  private token = randomBytes(32).toString('hex')
  private port = 0
  private stopping = false
  status: AppStatus = { state: 'starting', message: '正在启动本地服务' }
  constructor(private command: string, private args: string[], private cwd: string) {}
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
            if (event.type !== 'listening' || !Number.isInteger(event.port) || event.port < 1 || event.port > 65535) return fail()
            this.port = event.port
            clearTimeout(timer)
            resolve()
          } catch { fail() }
        })
        child.stdin.write(JSON.stringify({ token: this.token }) + '\n')
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
      const code = error instanceof Error && ['START_TIMEOUT', 'START_FAILED', 'HEALTH_TIMEOUT'].includes(error.message) ? error.message : 'SPAWN_FAILED'
      this.status = { state: 'failed', code, message: `本地服务启动失败（${code}），请检查安装完整性后重新打开知栖` }
      await this.stop()
    }
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

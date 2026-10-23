import { expect, test } from 'vitest'
import { Backend } from '../src/main/backend'
import { resolve } from 'node:path'
test('missing executable reports failure without rejecting or leaking a child', async () => {
  const backend = new Backend(resolve('missing-python.exe'), [], process.cwd())
  await backend.start()
  expect(backend.status.state).toBe('failed')
  await backend.stop()
})

test('closing before startup prevents spawning a service', async () => {
  const backend = new Backend(resolve('missing-python.exe'), [], process.cwd())
  await backend.stop()
  await backend.start()
  expect(backend.status.state).toBe('starting')
})

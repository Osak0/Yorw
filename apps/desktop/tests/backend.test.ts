import { expect, test } from 'vitest'
import { Backend } from '../src/main/backend'
import { resolve } from 'node:path'
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms))
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

test('unexpected service death changes status and normal stop releases the child',async()=>{
 const code=`const http=require('node:http');process.stdin.once('data',()=>{const server=http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify({api_version:'1',ready:true}))});server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({type:'listening',port:server.address().port})+'\\n'));process.stdin.on('end',()=>server.close(()=>process.exit(0)))})`
 const backend=new Backend(process.execPath,['-e',code],process.cwd())
 try{await backend.start();expect(backend.status.state).toBe('ready');expect(backend.processId).toBeTypeOf('number');process.kill(backend.processId!);for(let i=0;i<100&&backend.status.state!=='failed';i++)await delay(20);expect(backend.status.state).toBe('failed')}
 finally{await backend.stop()}
 const normal=new Backend(process.execPath,['-e',code],process.cwd())
 await normal.start();const pid=normal.processId!;await normal.stop()
 expect(()=>process.kill(pid,0)).toThrow()
},10000)

test('safe startup error is preserved for a newer database',async()=>{
 const code=`process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({type:'startup_error',code:'DATABASE_TOO_NEW'})+'\\n');process.stdin.on('end',()=>process.exit(0))})`
 const backend=new Backend(process.execPath,['-e',code],process.cwd())
 await backend.start();expect(backend.status).toMatchObject({state:'failed',code:'DATABASE_TOO_NEW'});await backend.stop()
})

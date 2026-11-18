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


test('profiles isolate keys, copy legacy ciphertext before old settings change, and validate addresses',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'yorw-profiles-'))
 const id='00000000-0000-4000-8000-000000000001'
 let chat:any={kind:'chat',base_url:'https://api.deepseek.com',model:'old',version:1}
 let profile:any={id,name:'Legacy',provider:'compatible',base_url:chat.base_url,model:'old',version:1,legacy_version:1,chat_check:null,tools_check:null}
 const backend={request:vi.fn(async(path,method,body)=>{
  if(path==='/v1/providers/profiles')return {items:[profile],defaults:{research_id:id,memory_id:null,version:1}}
  if(path===`/v1/providers/profiles/${id}`&&method==='PUT'){profile={...body,id,version:body.version+1,legacy_version:null};return profile}
  if(path==='/v1/providers/chat'&&method==='PUT'){chat={...body,kind:'chat',version:body.version+1};return chat}
  if(path.includes('/checks/'))return {id:'job'}
  return {items:[chat]}
 })} as unknown as Backend
 try{
  const {writeFile}=await import('node:fs/promises')
  await writeFile(join(directory,'chat-1.enc'),await safeStorage.encryptStringAsync('legacy-secret'))
  const providers=new Providers(backend,directory)
  expect((await providers.profileList()).items[0].has_key).toBe(true)
  await providers.save({...chat,key:'changed-secret'})
  const saved=await providers.profileSave({...profile,key:''})
  expect(saved.has_key).toBe(true)
  await providers.profileTest({id,kind:'tools'})
  expect(vi.mocked(backend.request).mock.calls.at(-1)?.[3]).toBe('legacy-secret')
  expect(JSON.stringify(saved)).not.toContain('secret')
  expect((await readFile(join(directory,`profile-${id}-2.enc`))).toString()).not.toContain('legacy-secret')
  await expect(providers.profileSave({...profile,base_url:'https://different.example'})).rejects.toThrow('KEY_REENTRY_REQUIRED')
  expect(()=>providers.profileCheck('../private')).toThrow('INVALID_CONFIG')
 }finally{await rm(directory,{recursive:true,force:true})}
})

import { safeStorage } from 'electron'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Backend } from './backend'
import type { ProviderConfig, ProviderInput, ProviderKind, ModelProfile, ProfileInput, ModelDefaults } from '../shared/status'

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
    await this.profileList()
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
  async chatCredentials() {
    await this.queue.catch(() => {})
    const config = (await this.backend.request('/v1/providers')).items.find((item: ProviderConfig) => item.kind === 'chat') as ProviderConfig | undefined
    return config ? { version: config.version, key: await this.key(config).catch(() => '') } : {version:0,key:''}
  }
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
  private profileId(id: string) { if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('INVALID_CONFIG'); return id }
  private profilePath(id:string,version:number) { return join(this.directory, `profile-${this.profileId(id)}-${version}.enc`) }
  private async profileKey(item:ModelProfile):Promise<string> {
    let data:Buffer
    try {data=await readFile(this.profilePath(item.id,item.version))}
    catch(error){
      if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('KEY_UNAVAILABLE')
      if(item.legacy_version===null)return ''
      try{data=await readFile(this.path('chat',item.legacy_version))}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return '';throw new Error('KEY_UNAVAILABLE')}
      await mkdir(this.directory,{recursive:true})
      await writeFile(this.profilePath(item.id,item.version),data,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error})
    }
    if(!(await safeStorage.isAsyncEncryptionAvailable()))throw new Error('SECURE_STORAGE_UNAVAILABLE')
    return (await safeStorage.decryptStringAsync(data)).result
  }
  async profileList() {
    const result=await this.backend.request('/v1/providers/profiles')
    result.items=await Promise.all(result.items.map(async(item:ModelProfile)=>{
      try{return {...item,has_key:!!(await this.profileKey(item))}}catch{return {...item,has_key:false,key_error:true}}
    }))
    return result
  }
  private serializeProfile<T>(action:()=>Promise<T>):Promise<T>{const job=this.queue.catch(()=>{}).then(action);this.queue=job;return job}
  profileSave(input:ProfileInput) {return this.serializeProfile(async()=>{
    this.profileId(input?.id)
    if(!Number.isInteger(input.version)||input.version<0||typeof input.base_url!=='string'||typeof input.model!=='string'||typeof input.name!=='string'||(input.key!==undefined&&typeof input.key!=='string')||(input.key?.length??0)>8192||/[\r\n]/.test(input.key??''))throw new Error('INVALID_CONFIG')
    const old=(await this.profileList()).items.find((p:ModelProfile)=>p.id===input.id) as ModelProfile|undefined
    if((old?.version??0)!==input.version)throw new Error('CONFIG_CONFLICT')
    if(old&&old.base_url!==input.base_url.replace(/\/$/,'')&&!input.clear_key&&!input.key)throw new Error('KEY_REENTRY_REQUIRED')
    const key=input.clear_key?'':input.key||(old?await this.profileKey(old):'')
    const target=this.profilePath(input.id,input.version+1)
    if(key){
      if(!(await safeStorage.isAsyncEncryptionAvailable()))throw new Error('SECURE_STORAGE_UNAVAILABLE')
      await mkdir(this.directory,{recursive:true});const temp=join(this.directory,randomUUID()+'.tmp')
      try{await writeFile(temp,await safeStorage.encryptStringAsync(key),{flag:'wx'});await rename(temp,target)}finally{await unlink(temp).catch(()=>{})}
    }else await unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error})
    const saved=await this.backend.request(`/v1/providers/profiles/${input.id}`,'PUT',{name:input.name,provider:input.provider,base_url:input.base_url,model:input.model,version:input.version})
    if(old)await unlink(this.profilePath(old.id,old.version)).catch(()=>{})
    return {...saved,has_key:!!key}
  })}
  profileDefaults(input:ModelDefaults){return this.serializeProfile(async()=>{
    for(const id of [input.research_id,input.memory_id])if(id!==null)this.profileId(id)
    return this.backend.request('/v1/providers/profiles/defaults','PUT',input)
  })}
  profileRemove(input:{id:string;version:number}){return this.serializeProfile(async()=>{
    this.profileId(input.id);if(!Number.isInteger(input.version)||input.version<1)throw new Error('INVALID_CONFIG')
    const result=await this.backend.request(`/v1/providers/profiles/${input.id}?version=${input.version}`,'DELETE')
    await unlink(this.profilePath(input.id,input.version)).catch(()=>{});return result
  })}
  profileTest(input:{id:string;kind:'chat'|'tools'}){return this.serializeProfile(async()=>{
    this.profileId(input.id);if(!['chat','tools'].includes(input.kind))throw new Error('INVALID_CONFIG')
    const item=(await this.profileList()).items.find((p:ModelProfile)=>p.id===input.id) as ModelProfile|undefined
    if(!item)throw new Error('PROFILE_NOT_FOUND')
    return this.backend.request(`/v1/providers/profiles/${input.id}/checks/${input.kind}`,'POST',{},await this.profileKey(item))
  })}
  profileCheck(id:string){return this.backend.request(`/v1/providers/profiles/checks/${this.profileId(id)}`)}
  profileCancel(id:string){return this.backend.request(`/v1/providers/profiles/checks/${this.profileId(id)}/cancel`,'POST',{})}

  async researchCredentials(id?:string){
    await this.queue.catch(()=>{})
    const profiles=await this.profileList()
    const chosen=id??profiles.defaults.research_id
    if(!chosen)throw new Error('CONFIG_MISSING')
    this.profileId(chosen)
    const profile=profiles.items.find((item:ModelProfile)=>item.id===chosen) as ModelProfile|undefined
    if(!profile)throw new Error('PROFILE_NOT_FOUND')
    return {profile_id:chosen,config_version:profile.version,key:await this.profileKey(profile)}
  }

}

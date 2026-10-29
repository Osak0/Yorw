import type {Backend} from './backend'
import type {Providers} from './providers'
import type {AiInput,AiPreferences} from '../shared/status'

const uuid=(value:unknown):string=>{
 if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))throw new Error('INVALID_INPUT')
 return value
}
export class Intelligence{
 constructor(private backend:Backend,private providers:Providers){}
 preferences(){return this.backend.request('/v1/ai/preferences')}
 savePreferences(input:AiPreferences){
  if(!input||typeof input.semantic_enabled!=='boolean'||!Number.isSafeInteger(input.version)||input.version<1)throw new Error('INVALID_INPUT')
  if(input.metadata_enabled!==undefined&&typeof input.metadata_enabled!=='boolean')throw new Error('INVALID_INPUT')
  return this.backend.request('/v1/ai/preferences','PUT',{semantic_enabled:input.semantic_enabled,metadata_enabled:input.metadata_enabled??false,version:input.version})
 }
 get(identity:unknown){return this.backend.request(`/v1/ai/tasks/${uuid(identity)}`)}
 cancel(identity:unknown){return this.backend.request(`/v1/ai/tasks/${uuid(identity)}/cancel`,'POST',{})}
 latest(input:{kind:AiInput['kind'];target_id:string}){
  if(!input||!['search','chat','draft'].includes(input.kind))throw new Error('INVALID_INPUT')
  return this.backend.request(`/v1/ai/tasks?kind=${input.kind}&target_id=${uuid(input.target_id)}`)
 }
 async run(input:AiInput){
  if(!input||!['search','chat','draft'].includes(input.kind)||typeof input.text!=='string'||!input.text.trim()||input.text.length>(input.kind==='draft'?2000:4000))throw new Error('INVALID_INPUT')
  if(input.scope!==undefined&&!['topic','workspace'].includes(input.scope))throw new Error('INVALID_INPUT')
  if(input.kind!=='draft'&&input.scope!==undefined)throw new Error('INVALID_INPUT')
  const body={kind:input.kind,text:input.text.trim(),target_id:uuid(input.target_id),request_id:uuid(input.request_id),...(input.kind==='draft'?{base_revision_id:uuid(input.base_revision_id),...(input.scope?{scope:input.scope}:{})}:{})}
  const preference=await this.preferences()
  const [chat,embedding]=await Promise.all([
   this.providers.chatCredentials(),
   preference.semantic_enabled?this.providers.embeddingCredentials():this.backend.request('/v1/providers').then(value=>({key:'',version:value.items.find((c:{kind:string})=>c.kind==='embedding')?.version??0}))
  ])
  return this.backend.request('/v1/ai/tasks','POST',body,undefined,{chat,embedding})
 }
}

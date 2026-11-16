import type {Backend} from './backend'
import type {Providers} from './providers'
export class Research {
 constructor(private backend:Backend,private providers:Providers){}
 private id(value:string){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new Error('INVALID_INPUT');return value}
 list(){return this.backend.request('/v1/research/sessions')}
 get(input:{id:string;before?:number}){if(input.before!==undefined&&(!Number.isSafeInteger(input.before)||input.before<1))throw new Error('INVALID_INPUT');return this.backend.request(`/v1/research/sessions/${this.id(input.id)}${input.before?'?before='+input.before:''}`)}
 async ask(input:any){if(!input||typeof input.question!=='string'||!input.question.trim()||input.question.length>4000)throw new Error('INVALID_INPUT');this.id(input.request_id);if(input.session_id)this.id(input.session_id);const credentials=await this.providers.researchCredentials(input.profile_id);return this.backend.request('/v1/research/ask','POST',{question:input.question,request_id:input.request_id,session_id:input.session_id??null,scope:input.scope,profile_id:credentials.profile_id,config_version:credentials.config_version},credentials.key)}
 edit(input:any){return this.backend.request(`/v1/research/sessions/${this.id(input.id)}`,'PATCH',{version:input.version,...(input.scope?{scope:input.scope}:{}),...(input.archived!==undefined?{archived:input.archived}:{})})}
 remove(input:{id:string;version:number}){if(!Number.isSafeInteger(input.version)||input.version<1)throw new Error('INVALID_INPUT');return this.backend.request(`/v1/research/sessions/${this.id(input.id)}?version=${input.version}`,'DELETE')}
 cancel(id:string){return this.backend.request(`/v1/research/tasks/${this.id(id)}/cancel`,'POST',{})}
 events(input:{id:string;after:number}){if(!Number.isSafeInteger(input.after)||input.after<0)throw new Error('INVALID_INPUT');return this.backend.request(`/v1/research/sessions/${this.id(input.id)}/events?after=${input.after}`)}
}

/** Background maintenance uses a dedicated connection; it never occupies the foreground slot. */
export class ResearchMemory {
 private scanning=false
 constructor(private backend:Backend,private providers:Providers){}
 private key(value:string){if(value==='global'||/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))return value;throw new Error('INVALID_INPUT')}
 view(key:string){return this.backend.request(`/v1/research-memory/${this.key(key)}`)}
 edit(input:any){const {scope_key,...value}=input;return this.backend.request(`/v1/research-memory/${this.key(scope_key)}`,'PATCH',value)}
 preferences(input:unknown){return this.backend.request('/v1/research-memory/preferences','PUT',input)}
 export(key:string){return this.backend.request(`/v1/research-memory/${this.key(key)}/export`,'POST',{})}
 async scan(){
  if(this.scanning)return
  this.scanning=true
  try{
   const pending=await this.backend.request('/v1/research-memory/pending') as {items:{scope_key:string}[]}
   for(const item of pending.items){
    let credentials
    try{const profiles=await this.providers.profileList();credentials=await this.providers.researchCredentials(profiles.defaults.memory_id??profiles.defaults.research_id??undefined)}
    catch{await this.backend.request(`/v1/research-memory/${this.key(item.scope_key)}/local`,'POST',{});continue}
    await this.backend.request(`/v1/research-memory/${this.key(item.scope_key)}/compress`,'POST',{profile_id:credentials.profile_id,config_version:credentials.config_version},credentials.key)
   }
  }catch{/* Maintenance failures do not affect foreground questions; journal remains durable. */}
  finally{this.scanning=false}
 }
}

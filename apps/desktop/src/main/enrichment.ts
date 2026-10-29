import type {Backend} from './backend'
import type {Providers} from './providers'
import type {EnrichmentDecision,EnrichmentSettings} from '../shared/status'

const uuid=(value:unknown)=>{
 if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))throw new Error('INVALID_INPUT')
 return value
}
export class Enrichment {
 private scanning=false
 constructor(private backend:Backend,private providers:Providers){}
 settings(){return this.backend.request('/v1/enrichment/settings')}
 save(input:EnrichmentSettings){
  if(!input||typeof input.enabled!=='boolean'||!Number.isSafeInteger(input.version)||input.version<1)throw new Error('INVALID_INPUT')
  return this.backend.request('/v1/enrichment/settings','PUT',{enabled:input.enabled,version:input.version})
 }
 view(id:unknown){return this.backend.request(`/v1/enrichment/documents/${uuid(id)}`)}
 cancel(id:unknown){return this.backend.request(`/v1/enrichment/documents/${uuid(id)}/cancel`,'POST',{})}
 decide(input:EnrichmentDecision){
  if(!input||!Number.isSafeInteger(input.enrichment_id)||input.enrichment_id<1||!['hide','dismiss_tag','accept_topic','dismiss_topic'].includes(input.action)||typeof input.value!=='string'||input.value.length>100)throw new Error('INVALID_INPUT')
  return this.backend.request(`/v1/enrichment/documents/${uuid(input.id)}/decide`,'POST',{enrichment_id:input.enrichment_id,action:input.action,value:input.value})
 }
 async generate(id:unknown,automatic=false){
  const identity=uuid(id),chat=await this.providers.chatCredentials()
  return this.backend.request(`/v1/enrichment/documents/${identity}/generate`,'POST',{automatic,regenerate:!automatic},undefined,{chat,embedding:{key:'',version:0}})
 }
 async scan(){
  if(this.scanning||this.backend.status.state!=='ready')return
  this.scanning=true
  try {
   const pending=await this.backend.request('/v1/enrichment/pending') as {items:string[]}
   for(const identity of pending.items)await this.generate(identity,true)
  } catch { /* Explicit retry in document resources; no automatic retry of paid jobs. */ }
  finally{this.scanning=false}
 }
}

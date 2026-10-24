import type {Backend} from './backend'
import type {Providers} from './providers'
import type {SuggestionInput} from '../shared/status'
function id(value:unknown):string{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))throw new Error('INVALID_INPUT');return value}
function payload(input:SuggestionInput){
 if(!input||typeof input.instruction!=='string'||!input.instruction.trim()||input.instruction.length>2000||!Array.isArray(input.materials)||!input.materials.length||input.materials.length>8)throw new Error('INVALID_INPUT')
 return {base_revision_id:id(input.base_revision_id),instruction:input.instruction.trim(),materials:input.materials.map(m=>{
  if(!m||!['document','note','message'].includes(m.kind)||typeof m.version!=='string'||!m.version||m.version.length>128||!Array.isArray(m.segment_ids)||m.segment_ids.length>8)throw new Error('INVALID_INPUT')
  return {kind:m.kind,id:id(m.id),version:m.version,segment_ids:m.segment_ids.map(id)}
 })}
}
export class Suggestions{
 constructor(private backend:Backend,private providers:Providers){}
 catalog(){return this.backend.request('/v1/materials')}
 list(value:unknown){return this.backend.request(`/v1/topics/${id(value)}/suggestions`)}
 preview(input:SuggestionInput){return this.backend.request(`/v1/topics/${id(input?.topic_id)}/materials/preview`,'POST',payload(input))}
 cancel(value:unknown){return this.backend.request(`/v1/suggestions/${id(value)}/cancel`,'POST',{})}
 async generate(input:SuggestionInput&{request_id:string;config_version:number}){
  const body=payload(input),topic=id(input.topic_id),request_id=id(input.request_id)
  if(!Number.isSafeInteger(input.config_version)||input.config_version<1)throw new Error('INVALID_INPUT')
  const credentials=await this.providers.chatCredentials()
  if(credentials.version!==input.config_version)throw new Error('CONFIG_CHANGED')
  return this.backend.request(`/v1/topics/${topic}/suggestions`,'POST',{...body,request_id,config_version:credentials.version},credentials.key)
 }
}

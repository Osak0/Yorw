import type {Backend} from './backend'
import type {TopicFields} from '../shared/status'
function id(value:unknown):string {
 if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))throw new Error('INVALID_INPUT')
 return value
}
function fields(value:TopicFields):TopicFields {
 if(!value||typeof value.title!=='string'||!value.title.trim()||value.title.trim().length>120)throw new Error('INVALID_INPUT')
 return {title:value.title.trim(),parent_id:value.parent_id===null?null:id(value.parent_id)}
}
export class Garden {
 constructor(private backend:Backend){}
 list(){return this.backend.request('/v1/topics')}
 get(value:unknown){return this.backend.request(`/v1/topics/${id(value)}`)}
 history(value:unknown){return this.backend.request(`/v1/topics/${id(value)}/revisions`)}
 create(input:TopicFields&{id:string}){return this.backend.request('/v1/topics','POST',{id:id(input?.id),...fields(input)})}
 update(input:TopicFields&{id:string;version:number}){
  if(!input||!Number.isSafeInteger(input.version)||input.version<1)throw new Error('INVALID_INPUT')
  return this.backend.request(`/v1/topics/${id(input.id)}`,'PATCH',{...fields(input),version:input.version})
 }
 save(input:{id:string;base_revision_id:string;body_md:string}){
  if(!input||typeof input.body_md!=='string'||input.body_md.length>200000)throw new Error('INVALID_INPUT')
  return this.backend.request(`/v1/topics/${id(input.id)}/revisions`,'POST',{body_md:input.body_md,base_revision_id:id(input.base_revision_id)})
 }
}

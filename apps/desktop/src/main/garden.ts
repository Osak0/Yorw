import type {Backend} from './backend'
import type {TopicFields,WikiDecisionInput} from '../shared/status'
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
 remove(input:{id:string;version:number;notebook_action?:string;destination_topic_id?:string|null}){
  if(!input||!Number.isSafeInteger(input.version)||input.version<1)throw new Error('INVALID_INPUT')
  return this.backend.request(`/v1/topics/${id(input.id)}`,'DELETE',{version:input.version,...(input.notebook_action?{notebook_action:input.notebook_action}:{}),...(input.destination_topic_id?{destination_topic_id:id(input.destination_topic_id)}:{})})
 }
 prepareReadingNote(input:{id:string;version:number}){return this.backend.request(`/v1/notes/${id(input.id)}/prepare-optimization`,'POST',{version:input.version})}
 readingHistory(value:string){return this.backend.request(`/v1/notes/${id(value)}/revisions`)}
 notebookCatalog(){return this.backend.request('/v1/notebooks')}
 overview(value:string){return this.backend.request(`/v1/topics/${id(value)}/overview`)}
 noteScope(value:string){return this.backend.request(`/v1/topics/${id(value)}/note-scope`)}
 saveNoteScope(input:any){return this.backend.request(`/v1/topics/${id(input.id)}/note-scope`,'PUT',{version:input.version,rules:input.rules})}
 notebook(value:string){return this.backend.request(`/v1/notebooks/${id(value)}`)}
 createNotebook(input:any){return this.backend.request(`/v1/topics/${id(input.topic_id)}/notebooks`,'POST',{id:id(input.id),title:input.title})}
 renameNotebook(input:any){return this.backend.request(`/v1/notebooks/${id(input.id)}`,'PATCH',{title:input.title,version:input.version})}
 removeNotebook(input:any){return this.backend.request(`/v1/notebooks/${id(input.id)}`,'DELETE',{version:input.version})}
 movePreview(input:any){return this.backend.request(`/v1/topics/${id(input.id)}/move-preview`,'POST',{parent_id:input.parent_id===null?null:id(input.parent_id)})}
 list(){return this.backend.request('/v1/topics')}
 get(value:unknown){return this.backend.request(`/v1/topics/${id(value)}`)}
 history(value:unknown){return this.backend.request(`/v1/topics/${id(value)}/revisions`)}
 accept(input:WikiDecisionInput&{id:string;body_md:string;apply_mode?:'append'|'replace'}){
  if(!input||typeof input.body_md!=='string'||!input.body_md.trim()||input.body_md.length>200000)throw new Error('INVALID_INPUT')
  if(input.apply_mode!==undefined&&!['append','replace'].includes(input.apply_mode))throw new Error('INVALID_INPUT')
  return this.backend.request(`/v1/suggestions/${id(input.id)}/accept`,'POST',{...this.decision(input),body_md:input.body_md,...(input.apply_mode?{apply_mode:input.apply_mode}:{})})
 }
 reject(input:WikiDecisionInput&{id:string}){return this.backend.request(`/v1/suggestions/${id(input?.id)}/reject`,'POST',this.decision(input))}
 restore(input:WikiDecisionInput&{id:string;revision_id:string}){return this.backend.request(`/v1/topics/${id(input?.id)}/revisions/${id(input?.revision_id)}/restore`,'POST',this.decision(input))}
 private decision(input:WikiDecisionInput){return {request_id:id(input?.request_id),base_revision_id:id(input?.base_revision_id)}}
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

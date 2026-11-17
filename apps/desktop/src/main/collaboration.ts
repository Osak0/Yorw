import type {Backend} from './backend'

/** Fixed collaboration routes only; no provider credentials or arbitrary URLs. */
export class Collaboration {
 constructor(private backend:Backend){}
 private id(value:string){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new Error('INVALID_INPUT');return value}
 list(input:{task_id?:string;document_id?:string;topic_id?:string}){const key=input.task_id?'task_id':input.document_id?'document_id':'topic_id';return this.backend.request(`/v1/collaboration/proposals?${key}=${this.id(input[key]!)}`)}
 get(id:string){return this.backend.request(`/v1/collaboration/proposals/${this.id(id)}`)}
 preview(input:unknown){return this.backend.request('/v1/collaboration/preview','POST',input)}
 decide(input:{id:string;action:string;request_id:string;version:number;selected:string[]}){if(!['accept','reject','undo','repair'].includes(input.action)||!Number.isSafeInteger(input.version)||input.version<1)throw new Error('INVALID_INPUT');return this.backend.request(`/v1/collaboration/proposals/${this.id(input.id)}/${input.action}`,'POST',{request_id:this.id(input.request_id),version:input.version,selected:input.selected})}
 candidates(input:{kind:string;id:string;query?:string}){if(!['document','topic'].includes(input.kind)||typeof (input.query??'')!=='string'||(input.query??'').length>200)throw new Error('INVALID_INPUT');return this.backend.request(`/v1/collaboration/candidates/${input.kind}/${this.id(input.id)}?query=${encodeURIComponent(input.query??'')}`)}
 topics(id:string){return this.backend.request(`/v1/collaboration/topics/${this.id(id)}/relations`)}
}

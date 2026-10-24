import type {GardenBridge,Topic,TopicView} from '../shared/status'
export interface WikiDraft {id:string;body:string;savedBody:string;base:string;saving:boolean;conflict:boolean;message:string}
interface Snapshot {topics:Topic[];selected:string;drafts:Record<string,WikiDraft>;loading:boolean;error:string}
export const wikiDirty=(draft:WikiDraft)=>draft.body!==draft.savedBody
const explain=(code:string)=>({REVISION_CONFLICT:'正文已有新修订，草稿已保留。请比较最新版本后决定。',TOPIC_CONFLICT:'目录已更新，请刷新目录后重试；输入仍保留。',TOPIC_CYCLE:'不能将专题移动到自身或其后代。',TOPIC_NOT_FOUND:'专题不存在，请刷新目录。',BACKEND_NOT_READY:'本地服务不可用，草稿已保留。',INVALID_INPUT:'输入无效或正文超过 200,000 字。'}[code]??`操作失败（${code}），草稿已保留。`)
export class GardenBook {
 private state:Snapshot={topics:[],selected:'',drafts:{},loading:false,error:''}
 private listeners=new Set<()=>void>()
 constructor(private bridge:GardenBridge){}
 getSnapshot=()=>this.state
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn)}}
 private publish(update:Partial<Snapshot>){this.state={...this.state,...update};this.listeners.forEach(fn=>fn())}
 private patch(id:string,update:Partial<WikiDraft>){const draft=this.state.drafts[id];if(draft)this.publish({drafts:{...this.state.drafts,[id]:{...draft,...update}}})}
 private topic(value:Topic){const topics=this.state.topics.filter(item=>item.id!==value.id);this.publish({topics:[...topics,value]})}
 hasUnsaved(){return Object.values(this.state.drafts).some(d=>wikiDirty(d)||d.saving)}
 async refresh(){this.publish({loading:true,error:''});try{const result=await this.bridge.list();if(result.ok)this.publish({topics:result.value.items});else this.publish({error:explain(result.code)})}catch{this.publish({error:'目录加载失败，请重试。'})}finally{this.publish({loading:false})}}
 async select(id:string){this.publish({selected:id,error:''});if(this.state.drafts[id])return
  try{const result=await this.bridge.get(id);if(result.ok){const r=result.value.revision;this.topic(result.value.topic);if(!this.state.drafts[id])this.publish({drafts:{...this.state.drafts,[id]:{id,body:r.body_md,savedBody:r.body_md,base:r.id,saving:false,conflict:false,message:'已载入保存版本'}}})}else this.publish({error:explain(result.code)})}catch{this.publish({error:'正文加载失败，请重试。'})}}
 edit(id:string,body:string){this.patch(id,{body,message:''})}
 async create(title:string,parent_id:string|null,id=crypto.randomUUID()){const result=await this.bridge.create({id,title,parent_id});if(!result.ok)throw new Error(explain(result.code));this.topic(result.value.topic);await this.select(result.value.topic.id);return result.value.topic}
 async metadata(id:string,title:string,parent_id:string|null,version:number){const result=await this.bridge.update({id,title,parent_id,version});if(!result.ok)throw new Error(explain(result.code));this.topic(result.value.topic)}
 async save(id:string){const draft=this.state.drafts[id];if(!draft||draft.saving||draft.conflict||!wikiDirty(draft))return
  if(draft.body.length>200000){this.patch(id,{message:explain('INVALID_INPUT')});return}
  const submitted=draft.body,base=draft.base;this.patch(id,{saving:true,message:'正在保存修订…'})
  try{const result=await this.bridge.save({id,body_md:submitted,base_revision_id:base});if(result.ok){this.topic(result.value.topic);this.patch(id,{savedBody:submitted,base:result.value.revision.id,message:`已保存 · 修订 ${result.value.revision.ordinal}`})}else this.patch(id,{conflict:result.code==='REVISION_CONFLICT',message:explain(result.code)})}catch{this.patch(id,{message:'保存失败或状态不确定；草稿保留，可重试确认。'})}finally{this.patch(id,{saving:false})}}
 async latest(id:string):Promise<TopicView>{const result=await this.bridge.get(id);if(!result.ok)throw new Error(explain(result.code));return result.value}
 acceptLatest(value:TopicView,keepDraft:boolean){const id=value.topic.id;this.topic(value.topic);this.patch(id,{...(keepDraft?{}:{body:value.revision.body_md}),savedBody:value.revision.body_md,base:value.revision.id,conflict:false,message:keepDraft?'已采用最新基线，草稿仍保留；确认内容后再保存。':'已载入最新保存版本'})}
}
let book:GardenBook|undefined
export function gardenBook(){return book??=new GardenBook(window.yorw.garden)}
export function hasUnsavedGarden(){return book?.hasUnsaved()??false}

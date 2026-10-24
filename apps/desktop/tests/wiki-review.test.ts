import {expect,test,vi} from 'vitest'
import {GardenBook} from '../src/renderer/garden-book'
import {Garden} from '../src/main/garden'
import type {GardenBridge,TopicView,Suggestion,WikiDecisionResult,Result} from '../src/shared/status'
import type {Backend} from '../src/main/backend'
const id='12345678-1234-1234-1234-123456789abc'
const view=(body='',revision=id):TopicView=>({topic:{id,title:'Topic',parent_id:null,current_revision_id:revision,version:1,created_at:'',updated_at:''},revision:{id:revision,topic_id:id,ordinal:2,body_md:body,sources:[],origin:'manual',base_revision_id:null,restored_from_id:null,created_at:''}})
const suggestion={id,body_md:'Original [S1]',sources:[]} as unknown as Suggestion
function setup(){const bridge={get:vi.fn(async()=>({ok:true,value:view()})),accept:vi.fn(),restore:vi.fn(),reject:vi.fn()} as unknown as GardenBridge;return {bridge,book:new GardenBook(bridge)}}

test('review edits survive topic switching and failed confirmation, and guard unsaved close',async()=>{
 const {book,bridge}=setup();await book.select(id)
 const review={suggestion,current:view(),body:suggestion.body_md,requestId:id}
 book.review(id,review);book.editReview(id,'Edited [S1]');await book.select('other');await book.select(id)
 expect(book.hasUnsaved()).toBe(true)
 const edited=book.getSnapshot().reviews[id]
 vi.mocked(bridge.accept).mockResolvedValue({ok:false,code:'REVISION_CONFLICT'})
 await expect(book.decide(id,'accept',edited)).rejects.toThrow('正文已有新修订')
 expect(book.getSnapshot().reviews[id]).toBe(edited)
 expect(book.getSnapshot().drafts[id].body).toBe('')
 expect(bridge.accept).toHaveBeenCalledWith({id,request_id:edited.requestId,base_revision_id:id,body_md:'Edited [S1]'})
})

test('accept blocks dirty manual editor and preserves text entered during acknowledgement',async()=>{
 const {book,bridge}=setup();await book.select(id)
 const review={suggestion,current:view(),body:'Accepted [S1]',requestId:id};book.review(id,review);book.edit(id,'manual unsaved')
 await expect(book.decide(id,'accept',review)).rejects.toThrow('请先保存');expect(bridge.accept).not.toHaveBeenCalled()
 book.acceptLatest(view(),false)
 let finish!:(value:Result<WikiDecisionResult>)=>void
 vi.mocked(bridge.accept).mockImplementation(()=>new Promise(resolve=>{finish=resolve}))
 const pending=book.decide(id,'accept',review);book.edit(id,'typed during request')
 finish({ok:true,value:{view:view('Accepted [S1]','new'),decision:{action:'accept',request_id:id,revision_id:'new',suggestion_id:id}}});await pending
 expect(book.getSnapshot().drafts[id]).toMatchObject({body:'typed during request',savedBody:'Accepted [S1]',base:'new',saving:false})
 expect(book.getSnapshot().reviews[id]).toBeUndefined()
})

test('fixed decision routes reject renderer path and body injection',()=>{
 const request=vi.fn(),garden=new Garden({request} as unknown as Backend)
 garden.accept({id,request_id:id,base_revision_id:id,body_md:'Edited [S1]'})
 expect(request).toHaveBeenCalledWith(`/v1/suggestions/${id}/accept`,'POST',{request_id:id,base_revision_id:id,body_md:'Edited [S1]'})
 expect(()=>garden.restore({id,revision_id:'../escape',request_id:id,base_revision_id:id})).toThrow('INVALID_INPUT')
 expect(()=>garden.accept({id,request_id:id,base_revision_id:id,body_md:'x'.repeat(200001)})).toThrow('INVALID_INPUT')
})

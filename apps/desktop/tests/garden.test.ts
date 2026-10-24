import {expect,test,vi} from 'vitest'
import {GardenBook,wikiDirty} from '../src/renderer/garden-book'
import {Garden} from '../src/main/garden'
import type {GardenBridge,TopicView,Result} from '../src/shared/status'
import type {Backend} from '../src/main/backend'
const id='12345678-1234-1234-1234-123456789abc'
const view=(body='',revision='base'):TopicView=>({topic:{id,title:'Topic',parent_id:null,current_revision_id:revision,version:1,created_at:'',updated_at:''},revision:{id:revision,topic_id:id,ordinal:1,body_md:body,sources:[],origin:'manual',base_revision_id:null,restored_from_id:null,created_at:''}})
function setup(){const bridge={list:vi.fn(async()=>({ok:true,value:{items:[view().topic]}})),get:vi.fn(async()=>({ok:true,value:view()})),save:vi.fn()} as unknown as GardenBridge;return {bridge,book:new GardenBook(bridge)}}
test('save acknowledgement preserves newer edits, prevents duplicate requests and keeps failed drafts',async()=>{
 const {bridge,book}=setup();await book.refresh();await book.select(id);book.edit(id,'submitted')
 let finish!:(result:Result<TopicView>)=>void
 vi.mocked(bridge.save).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 const saving=book.save(id);await book.save(id);book.edit(id,'typed while saving');finish({ok:true,value:view('submitted','rev2')});await saving
 expect(bridge.save).toHaveBeenCalledTimes(1)
 expect(book.getSnapshot().drafts[id]).toMatchObject({body:'typed while saving',savedBody:'submitted',base:'rev2',saving:false})
 vi.mocked(bridge.save).mockResolvedValueOnce({ok:false,code:'BACKEND_NOT_READY'});await book.save(id)
 expect(book.getSnapshot().drafts[id].body).toBe('typed while saving');expect(book.hasUnsaved()).toBe(true)
})
test('conflicts block blind overwrite until explicitly selecting a new baseline',async()=>{
 const {bridge,book}=setup();await book.select(id);book.edit(id,'my draft')
 vi.mocked(bridge.save).mockResolvedValue({ok:false,code:'REVISION_CONFLICT'});await book.save(id);await book.save(id)
 expect(bridge.save).toHaveBeenCalledTimes(1);expect(book.getSnapshot().drafts[id].conflict).toBe(true)
 book.acceptLatest(view('remote','rev3'),true)
 expect(book.getSnapshot().drafts[id]).toMatchObject({body:'my draft',savedBody:'remote',base:'rev3',conflict:false})
 book.acceptLatest(view('remote','rev3'),false);expect(wikiDirty(book.getSnapshot().drafts[id])).toBe(false)
})
test('topic switching and directory refresh do not discard unsaved bodies',async()=>{
 const {book}=setup();await book.select(id);book.edit(id,'persistent session draft');await book.select('other');await book.refresh();await book.select(id)
 expect(book.getSnapshot().drafts[id].body).toBe('persistent session draft')
})
test('main exposes only bounded, fixed Garden routes',async()=>{
 const request=vi.fn(async()=>({})),garden=new Garden({request} as unknown as Backend)
 garden.create({id,title:' Topic ',parent_id:null});expect(request).toHaveBeenCalledWith('/v1/topics','POST',{id,title:'Topic',parent_id:null})
 expect(()=>garden.get('../escape')).toThrow('INVALID_INPUT')
 expect(()=>garden.update({id,title:'a',parent_id:null,version:0})).toThrow('INVALID_INPUT')
 expect(()=>garden.save({id,body_md:'x'.repeat(200001),base_revision_id:id})).toThrow('INVALID_INPUT')
})

import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {expect,test,vi} from 'vitest'
import {Intelligence} from '../src/main/intelligence'
import {SearchPanel} from '../src/renderer/SearchPanel'
import {ChatPanel} from '../src/renderer/ChatPanel'
import {SuggestionsPanel} from '../src/renderer/SuggestionsPanel'
import {aiError} from '../src/renderer/ai-task'
import type {Backend} from '../src/main/backend'
import type {Providers} from '../src/main/providers'
const id='12345678-1234-1234-1234-123456789abc'

test('one-submit bridge validates IDs and keeps distinct credentials out of renderer payload',async()=>{
 const request=vi.fn(async(path:string)=>path==='/v1/ai/preferences'?{semantic_enabled:true,version:1}:{id})
 const providers={chatCredentials:vi.fn(async()=>({key:'chat-secret',version:1})),embeddingCredentials:vi.fn(async()=>({key:'embedding-secret',version:2}))}
 const api=new Intelligence({request} as unknown as Backend,providers as unknown as Providers)
 await api.run({kind:'chat',target_id:id,text:'What does this paper show?',request_id:id})
 expect(request).toHaveBeenLastCalledWith('/v1/ai/tasks','POST',{kind:'chat',target_id:id,text:'What does this paper show?',request_id:id},undefined,{chat:{key:'chat-secret',version:1},embedding:{key:'embedding-secret',version:2}})
 await expect(api.run({kind:'search',target_id:'../escape',text:'question',request_id:id})).rejects.toThrow('INVALID_INPUT')
 await expect(api.run({kind:'draft',target_id:id,text:'draft',request_id:id})).rejects.toThrow('INVALID_INPUT')
 await api.run({kind:'draft',target_id:id,text:'draft',request_id:id,base_revision_id:id,scope:'workspace'})
 expect(request).toHaveBeenLastCalledWith('/v1/ai/tasks','POST',{kind:'draft',target_id:id,text:'draft',request_id:id,base_revision_id:id,scope:'workspace'},undefined,{chat:{key:'chat-secret',version:1},embedding:{key:'embedding-secret',version:2}})
 await expect(api.run({kind:'search',target_id:id,text:'question',request_id:id,scope:'topic'})).rejects.toThrow('INVALID_INPUT')
 expect(()=>api.savePreferences({semantic_enabled:'yes' as unknown as boolean,version:1})).toThrow('INVALID_INPUT')
})

test('draft AI panel defaults to topic scope and exposes an explicit workspace switch',()=>{
 expect(aiError('NO_SCOPED_MATERIALS')).toContain('全工作区')
 const html=renderToStaticMarkup(<SuggestionsPanel topicId={id} baseRevisionId={id} dirty={false} onReview={()=>{}}/>)
 expect(html).toContain('AI 材料范围')
 expect(html).toContain('当前专题及子专题')
 expect(html).toContain('全工作区')
 expect(html).toContain('本专题及子专题关联的文献、笔记和子专题 Wiki')
})

test('search and chat expose a single primary submission without index, threshold or consent controls',()=>{
 const search=renderToStaticMarkup(<SearchPanel documentId={id} onPage={()=>{}}/>),chat=renderToStaticMarkup(<ChatPanel documentId={id} onPage={()=>{}} onNote={()=>{}}/>)
 expect(search).toContain('搜索');expect(chat).toContain('发送')
 for(const html of [search,chat])for(const forbidden of ['checkbox','相似度','分块','索引','收费','计费','准备本次证据','确认发送'])expect(html).not.toContain(forbidden)
})

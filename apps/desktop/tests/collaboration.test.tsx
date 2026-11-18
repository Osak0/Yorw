import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {expect,test,vi} from 'vitest'
import {Collaboration} from '../src/main/collaboration'
import {ProposalCard,selectProposalOperation} from '../src/renderer/Collaboration'
import {defaultProposalSelection} from '../src/renderer/proposal-model'
import type {Backend} from '../src/main/backend'
import type {CollaborationProposal} from '../src/shared/status'

const id='12345678-1234-4234-8234-123456789abc'
test('selection restores every prerequisite and cancellation preserves independent results',()=>{
 const operations=[{key:'root',depends_on:[]},{key:'child',depends_on:['root']},{key:'note',depends_on:['child']},{key:'independent',depends_on:[]}]
 const restored=selectProposalOperation(operations,['independent'],'note',true)
 expect(restored).toEqual(['root','child','note','independent'])
 expect(selectProposalOperation(operations,restored,'root',false)).toEqual(['independent'])
 expect(selectProposalOperation(operations,restored,'child',false)).toEqual(['root','independent'])
})
test('collaboration IPC permits only fixed routes, encoded query and bounded identity',async()=>{
 const request=vi.fn().mockResolvedValue({});const api=new Collaboration({request} as unknown as Backend)
 await api.candidates({kind:'document',id,query:'a & b'})
 expect(request).toHaveBeenLastCalledWith(`/v1/collaboration/candidates/document/${id}?query=a%20%26%20b`)
 expect(()=>api.candidates({kind:'../../secret',id})).toThrow('INVALID_INPUT')
 expect(()=>api.get('../secret')).toThrow('INVALID_INPUT')
 expect(()=>api.decide({id,action:'sql',request_id:id,version:1,selected:[]})).toThrow('INVALID_INPUT')
 await api.decide({id,action:'accept',request_id:id,version:1,selected:['note']})
 expect(request).toHaveBeenLastCalledWith(`/v1/collaboration/proposals/${id}/accept`,'POST',{request_id:id,version:1,selected:['note']})
})
test('answer cards stay compact and point to the proposal tab',()=>{
 const proposal={id,version:1,status:'pending',stale:true,conflict:'PROPOSAL_STALE',sources:[],decision:null,operations:[{key:'note',action:'create_note',title:'Candidate idea',reason:'User organization',owner:'$topic',owner_title:'',target:'',first:'',first_kind:'document',second:'',second_kind:'topic',body_md:'Hypothesis',after_body:'Hypothesis',before_body:'',diff:'+Hypothesis',object_id:id,depends_on:['topic']}]} as CollaborationProposal
 const markup=renderToStaticMarkup(<ProposalCard initial={proposal} onChanged={()=>{}}/>)
 expect(markup).toContain('新增笔记：Candidate idea')
 expect(markup).toContain('需要重新预览')
 expect(markup).toContain('1 项操作')
 expect(markup).toContain('查看方案')
 expect(markup).not.toContain('查看正文与差异')
})


test('extra recommendations start unselected while requested operations keep prerequisites',()=>{
 const operations=[{key:'topic',depends_on:[],recommended:false},{key:'note',depends_on:['topic'],recommended:false},{key:'extra',depends_on:[],recommended:true}] as CollaborationProposal['operations']
 expect(defaultProposalSelection(operations)).toEqual(['topic','note'])
})

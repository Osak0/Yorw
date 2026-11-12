import {expect,test,vi} from 'vitest'
import {Enrichment} from '../src/main/enrichment'
import type {Backend} from '../src/main/backend'
import type {Providers} from '../src/main/providers'
const id='00000000-0000-4000-8000-000000000001'
test('manual enrichment keeps credentials in main and restricts IPC inputs',async()=>{
 const request=vi.fn(async()=>({})),chatCredentials=vi.fn(async()=>({key:'private-key',version:3}))
 const service=new Enrichment({request} as unknown as Backend,{chatCredentials} as unknown as Providers)
 await service.generate(id)
 expect(request).toHaveBeenCalledWith(`/v1/enrichment/documents/${id}/generate`,'POST',{automatic:false,regenerate:true},undefined,{chat:{key:'private-key',version:3},embedding:{key:'',version:0}})
 expect(()=>service.view('../../file')).toThrow('INVALID_INPUT')
 expect(()=>service.decide({id,enrichment_id:1,action:'execute' as never,value:''})).toThrow('INVALID_INPUT')
 expect(()=>service.save({enabled:true,version:0})).toThrow('INVALID_INPUT')
})
test('automatic scan passes only pending IDs and never overlaps',async()=>{
 let release!:()=>void
 const gate=new Promise<void>(resolve=>{release=resolve})
 const request=vi.fn(async(path:string)=>{if(path.endsWith('/pending'))return {items:[id]};await gate;return {}})
 const service=new Enrichment({request,status:{state:'ready'}} as unknown as Backend,{chatCredentials:async()=>({key:'private-key',version:1})} as Providers)
 const first=service.scan();await Promise.resolve();await service.scan();release();await first
 expect(request.mock.calls.filter(([path])=>path.endsWith('/pending'))).toHaveLength(1)
 expect(request).toHaveBeenCalledWith(`/v1/enrichment/documents/${id}/generate`,'POST',{automatic:true,regenerate:false},undefined,expect.anything())
})


test('selection adoption forwards only allowed per-field operations and snapshot',async()=>{
 const request=vi.fn(async()=>({}))
 const service=new Enrichment({request} as unknown as Backend,{} as Providers)
 const input={id,enrichment_id:1,version:2,operations:{authors:'append',topics:'replace'},relation_snapshot:'snapshot'}
 await service.apply(input)
 expect(request).toHaveBeenCalledWith(`/v1/enrichment/documents/${id}/apply-selection`,'POST',{enrichment_id:1,version:2,operations:input.operations,relation_snapshot:'snapshot'})
 expect(()=>service.apply({...input,operations:{path:'replace'}})).toThrow('INVALID_INPUT')
 expect(()=>service.apply({...input,operations:{title:'execute'}})).toThrow('INVALID_INPUT')
 expect(()=>service.apply({...input,relation_snapshot:null})).toThrow('INVALID_INPUT')
})

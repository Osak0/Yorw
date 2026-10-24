import {expect,test,vi} from 'vitest'
import {Suggestions} from '../src/main/suggestions'
import type {Backend} from '../src/main/backend'
import type {Providers} from '../src/main/providers'
const id='12345678-1234-1234-1234-123456789abc'
test('material preview does not access credentials and generation uses a private header',async()=>{
 const request=vi.fn(async()=>({})),chatCredentials=vi.fn(async()=>({version:2,key:'secret'}))
 const service=new Suggestions({request} as unknown as Backend,{chatCredentials} as unknown as Providers)
 const input={topic_id:id,base_revision_id:id,instruction:'draft',materials:[{kind:'note' as const,id,version:'1',segment_ids:[]}]}
 await service.preview(input);expect(chatCredentials).not.toHaveBeenCalled()
 await service.generate({...input,request_id:id,config_version:2})
 expect(request).toHaveBeenLastCalledWith(`/v1/topics/${id}/suggestions`,'POST',{base_revision_id:id,instruction:'draft',materials:input.materials,request_id:id,config_version:2},'secret')
 await expect(service.generate({...input,request_id:id,config_version:1})).rejects.toThrow('CONFIG_CHANGED')
 expect(()=>service.preview({...input,materials:[]})).toThrow('INVALID_INPUT')
 expect(()=>service.preview({...input,topic_id:'../file'})).toThrow('INVALID_INPUT')
})

import {expect,test,vi} from 'vitest'
import {Chat} from '../src/main/chat'
import type {Backend} from '../src/main/backend'
import type {Providers} from '../src/main/providers'
test('chat credentials never cross renderer; bounded IDs and version are validated',async()=>{
 const request=vi.fn(async()=>({})),chatCredentials=vi.fn(async()=>({key:'secret',version:2}))
 const chat=new Chat({request} as unknown as Backend,{chatCredentials} as unknown as Providers)
 const id='12345678-1234-1234-1234-123456789abc'
 const input={document_id:id,question:'question',segment_ids:[id],config_version:2}
 await chat.ask(input)
 expect(request).toHaveBeenCalledWith(`/v1/documents/${id}/chat`,'POST',{question:'question',segment_ids:[id],config_version:2},'secret')
 await expect(chat.ask({...input,config_version:1})).rejects.toThrow('CONFIG_CHANGED')
 await expect(chat.ask({...input,segment_ids:['../file']})).rejects.toThrow('INVALID_INPUT')
 await expect(chat.ask({...input,segment_ids:[]})).rejects.toThrow('INVALID_INPUT')
 await expect(chat.ask({...input,segment_ids:Array(9).fill(id)})).rejects.toThrow('INVALID_INPUT')
})

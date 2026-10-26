import {expect,test} from 'vitest'
import {generationError} from '../src/renderer/generation-status'

test('completion errors give distinct recovery guidance without raw provider codes',()=>{
 const length=generationError('OUTPUT_TRUNCATED'),filter=generationError('CONTENT_FILTERED')
 expect(length).toContain('编辑补全')
 expect(filter).toContain('调整生成要求')
 expect(generationError('UPSTREAM_RESOURCE_UNAVAILABLE')).toContain('繁忙')
 for(const code of ['OUTPUT_TRUNCATED','CONTENT_FILTERED','UPSTREAM_ABORTED','UNKNOWN'])expect(generationError(code)).not.toContain(code)
})

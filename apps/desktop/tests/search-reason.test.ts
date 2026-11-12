import {expect,test} from 'vitest'
import {searchReason} from '../src/renderer/search-reason'
test('distinguishes missing configuration, credentials, and source changes',()=>{
 expect(searchReason('CONFIG_MISSING')).toContain('配置检索模型')
 expect(searchReason('KEY_MISSING')).toContain('密钥缺失')
 expect(searchReason('INDEX_SOURCE_CHANGED')).toContain('原文已变化')
})
test('does not expose untrusted provider error text',()=>{
 expect(searchReason('https://private?key=secret')).not.toContain('secret')
 expect(searchReason('UNKNOWN_REASON')).toContain('UNKNOWN_REASON')
})

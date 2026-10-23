import { expect, test, vi } from 'vitest'
import { Search } from '../src/main/search'
import type { Backend } from '../src/main/backend'
import type { Providers } from '../src/main/providers'

test('local retrieval never reads model credentials; semantic keys only enter private HTTP header', async () => {
  const request = vi.fn(async () => ({items:[]}))
  const embeddingCredentials = vi.fn(async () => ({version:3,key:'private-test-key'}))
  const search = new Search({request} as unknown as Backend,{embeddingCredentials} as unknown as Providers)
  const id = '12345678-1234-1234-1234-123456789abc'
  await search.query({id,query:'lung nodules',semantic:false,config_version:0})
  expect(embeddingCredentials).not.toHaveBeenCalled()
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${id}/search`,'POST',{query:'lung nodules',semantic:false,config_version:0,min_similarity:0.5},'')
  await search.index({id,semantic:true,config_version:3})
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${id}/index`,'POST',{semantic:true,config_version:3},'private-test-key')
  await search.query({id,query:'中文问题',semantic:true,config_version:3})
  expect(request).toHaveBeenLastCalledWith(`/v1/documents/${id}/search`,'POST',{query:'中文问题',semantic:true,config_version:3,min_similarity:0.5},'private-test-key')
  await expect(search.query({id:'../file',query:'x',semantic:true,config_version:3})).rejects.toThrow('INVALID_INPUT')
  await expect(search.query({id,query:' ',semantic:false,config_version:0})).rejects.toThrow('INVALID_INPUT')
  await expect(search.query({id,query:'x'.repeat(1001),semantic:false,config_version:0})).rejects.toThrow('INVALID_INPUT')
  await expect(search.index({id,semantic:true,config_version:2})).rejects.toThrow('CONFIG_CHANGED')
  expect(() => search.status('http://outside')).toThrow('INVALID_INPUT')
})

 test('semantic cutoff is validated and forwarded', async () => {
  const request = vi.fn(async () => ({}))
  const search = new Search({request} as unknown as Backend, {} as Providers)
  const input = {id:'12345678-1234-1234-1234-123456789abc',query:'x',semantic:false,config_version:0}
  for (const min_similarity of [NaN, Infinity, -0.1, 1.1]) await expect(search.query({...input,min_similarity})).rejects.toThrow('INVALID_INPUT')
  await search.query({...input,min_similarity:0.255})
  expect(request.mock.calls[0][2].min_similarity).toBe(0.255)
 })

import React, { useEffect, useState } from 'react'
import type { ProviderConfig, ProviderKind } from '../shared/status'
import {WorkspacePanel} from './WorkspacePanel'
import type {AiPreferences} from '../shared/status'

const messages: Record<string, string> = {
  INSUFFICIENT_BALANCE: '账号余额不足，请检查服务账户', CONNECTED: '连接成功', AUTH_FAILED: '鉴权失败，请检查 API Key 与账号权限', MODEL_OR_ENDPOINT_NOT_FOUND: '模型或接口不存在，请检查地址与模型名', RATE_LIMITED: '服务限流或额度不足，请稍后重试', TIMEOUT: '连接超时，请重试', NETWORK_ERROR: '网络连接失败，请检查网络与服务地址', INVALID_RESPONSE: '服务响应格式不兼容', KEY_MISSING: '请先保存 API Key', CONFIG_MISSING: '请先保存模型配置', CONFIG_CONFLICT: '配置已更新，请重新加载后再保存', INVALID_CONFIG: '配置格式错误，请检查 URL 与模型名', KEY_REENTRY_REQUIRED: '更换服务地址时，请重新输入密钥或选择清除密钥', KEY_UNAVAILABLE: '密钥无法解密，请重新输入', SECURE_STORAGE_UNAVAILABLE: '系统安全存储不可用，无法保存密钥', BACKEND_NOT_READY: '本地服务尚未就绪，请稍后重试', OPERATION_FAILED: '操作失败，请重试；草稿已保留', UPSTREAM_HTTP_ERROR: '服务请求失败，请检查服务状态', RESPONSE_TOO_LARGE: '测试响应过大'
}
function ProviderForm({ kind, saved, onSaved }: { kind: ProviderKind; saved?: ProviderConfig; onSaved: (config: ProviderConfig) => void }) {
  const [url, setUrl] = useState(saved?.base_url ?? (kind === 'chat' ? 'https://api.deepseek.com' : 'https://open.bigmodel.cn/api/paas/v4'))
  const [model, setModel] = useState(saved?.model ?? (kind === 'chat' ? 'deepseek-flash' : 'embedding-3'))
  const [key, setKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState(false)
  const dirty = url !== saved?.base_url || model !== saved?.model || !!key || clearKey
  async function run(test: boolean) {
    setBusy(true); setNotice(test ? '正在测试连接…' : '正在保存…'); setError(false)
    try {
      if (test) {
        const result = await window.yorw.providers.test(kind)
        if (!result.ok) { setError(true); setNotice(messages[result.code] ?? '测试失败'); return }
        setError(!result.value.ok)
        setNotice(messages[result.value.code] ?? '测试失败')
      } else {
        // Capture only in this submission; clear password state immediately.
        const request = { kind, base_url: url, model, key, clear_key: clearKey, version: saved?.version ?? 0 }
        setKey('')
        const result = await window.yorw.providers.save(request)
        request.key = ''
        if (!result.ok) { setError(true); setNotice(messages[result.code] ?? '保存失败，请重试'); return }
        onSaved(result.value); setUrl(result.value.base_url); setModel(result.value.model); setClearKey(false)
        setNotice('配置已保存，连接状态尚待测试')
      }
    } catch { setError(true); setNotice('操作失败，请重试；密钥需重新输入') }
    finally { setBusy(false) }
  }
  return <section className="provider"><h2>{kind === 'chat' ? '聊天模型 · DeepSeek / 兼容 API' : '检索模型 · 智谱 / 兼容 API'}</h2>
    <p>{kind === 'chat' ? '预设 DeepSeek 官方 API，可修改地址和模型名。' : '预设智谱 embedding-3，使用独立密钥。'}</p>
    <fieldset disabled={busy}>{kind === 'embedding' && <button onClick={() => { setUrl('https://open.bigmodel.cn/api/paas/v4'); setModel('embedding-3'); setKey(''); setClearKey(false); setNotice('已填入智谱预设，请核对并输入该服务的密钥后保存。') }}>使用智谱预设</button>}<label>API Base URL<input value={url} onChange={e => { setUrl(e.target.value); setNotice('') }} placeholder="https://api.example.com/v1" /></label>
    <label>模型名<input value={model} onChange={e => { setModel(e.target.value); setNotice('') }} /></label>
    <label>API Key <span>{saved?.key_error ? '（已有密钥不可用，请重新输入或清除）' : saved?.has_key ? '（已安全保存；留空保留）' : '（未保存）'}</span><input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} disabled={clearKey} placeholder="输入新密钥以替换，保存后不回显" /></label>
    <label className="check"><input type="checkbox" checked={clearKey} onChange={e => { setClearKey(e.target.checked); setKey('') }} />清除已保存密钥</label>
    <div className="actions"><button className="primary" onClick={() => void run(false)} disabled={!url.trim() || !model.trim()}>保存配置</button><button onClick={() => void run(true)} disabled={!saved || dirty}>测试已保存配置</button></div></fieldset>
    <p role="status" className={error ? 'failed' : ''}>{notice}</p>
  </section>
}
function AiSettings({active}:{active:boolean}){
 const [saved,setSaved]=useState<AiPreferences|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 useEffect(()=>{let alive=true;if(active)void window.yorw.ai.preferences().then(result=>{if(alive&&result.ok)setSaved(result.value)}).catch(()=>{if(alive)setNotice('检索设置加载失败，请重试。')});return()=>{alive=false}},[active])
 async function change(enabled:boolean){if(!saved)return;setBusy(true);setNotice('')
  try{const result=await window.yorw.ai.savePreferences({...saved,semantic_enabled:enabled});if(result.ok){setSaved(result.value);setNotice('已保存。')}else setNotice(messages[result.code]??'设置未保存，请重试。')}
  catch{setNotice('设置未保存，请重试。')}finally{setBusy(false)}
 }
 return <section className="provider"><h2>检索</h2><label className="check"><input aria-label="语义检索" type="checkbox" checked={saved?.semantic_enabled??true} disabled={!saved||busy} onChange={event=>void change(event.target.checked)}/>语义检索</label><p>结合问题含义查找相关内容。关闭后使用本地文字匹配。</p><p role="status">{notice}</p></section>
}
export function House({active=true}:{active?:boolean}) {
  const [configs, setConfigs] = useState<ProviderConfig[] | null>(null)
  const [notice, setNotice] = useState('正在加载配置…')
  async function load() {
    try { const result = await window.yorw.providers.list(); if (result.ok) { setConfigs(result.value); setNotice('') } else setNotice(messages[result.code] ?? '加载失败') }
    catch { setNotice('加载失败，请重试') }
  }
  useEffect(() => { void load() }, [])
  return <><AiSettings active={active}/><p>聊天与检索模型分别配置。密钥由系统安全存储加密。</p>{notice && <p role="status">{notice} <button onClick={() => void load()}>重新加载</button></p>}{configs && (['chat', 'embedding'] as ProviderKind[]).map(kind => <ProviderForm key={kind} kind={kind} saved={configs.find(config => config.kind === kind)} onSaved={saved => setConfigs(previous => [...(previous ?? []).filter(config => config.kind !== kind), saved])} />)}<WorkspacePanel active={active}/></>
}

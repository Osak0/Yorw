import React, { useEffect, useState } from 'react'
import type { ParserCapability, ParserSettings, ParserStatus, ProviderConfig, ProviderKind } from '../shared/status'
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
function AiSettings({active}:{active:boolean}){ const [saved,setSaved]=useState<AiPreferences|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 useEffect(()=>{let alive=true;if(active)void window.yorw.ai.preferences().then(result=>{if(alive&&result.ok)setSaved(result.value)}).catch(()=>{if(alive)setNotice('检索设置加载失败，请重试。')});return()=>{alive=false}},[active])
 async function change(enabled:boolean){if(!saved)return;setBusy(true);setNotice('')
  try{const result=await window.yorw.ai.savePreferences({...saved,semantic_enabled:enabled});if(result.ok){setSaved(result.value);setNotice('已保存。')}else setNotice(messages[result.code]??'设置未保存，请重试。')}
  catch{setNotice('设置未保存，请重试。')}finally{setBusy(false)}
 }
 return <section className="provider"><h2>检索</h2><label className="check"><input aria-label="语义检索" type="checkbox" checked={saved?.semantic_enabled??true} disabled={!saved||busy} onChange={event=>void change(event.target.checked)}/>语义检索</label><p>结合问题含义查找相关内容。关闭后使用本地文字匹配。</p><p role="status">{notice}</p></section>
}
const parserStateLabel: Record<ParserCapability['state'], string> = {
  builtin: '内置可用', external: '外部可用', component_missing: '组件缺失', unsupported: '不支持'
}
const parserFormats = ['pdf', 'docx', 'doc', 'md', 'txt'] as const

function ParserPanel({ active }: { active: boolean }) {
  const [status, setStatus] = useState<ParserStatus | null>(null)
  const [form, setForm] = useState<ParserSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('正在加载解析配置…')
  async function load() {
    try {
      const result = await window.yorw.parsers.status()
      if (result.ok) { setStatus(result.value); setForm(result.value.settings); setNotice('') }
      else setNotice(messages[result.code] ?? '解析配置加载失败，请重试。')
    } catch { setNotice('解析配置加载失败，请重试。') }
  }
  useEffect(() => { if (active) void load() }, [active])
  function update<K extends keyof ParserSettings>(key: K, value: ParserSettings[K]) {
    setForm(previous => previous ? { ...previous, [key]: value } : previous)
  }
  async function save() {
    if (!form) return
    setBusy(true); setNotice('正在保存解析配置…')
    try {
      const result = await window.yorw.parsers.save(form)
      if (result.ok) {
        setForm(result.value)
        setStatus(previous => previous ? { ...previous, settings: result.value } : previous)
        setNotice('解析配置已保存。')
      } else setNotice(result.code === 'CONFIG_CONFLICT' ? '配置已更新，请重新加载后再保存。' : messages[result.code] ?? '保存失败，请重试。')
    } catch { setNotice('保存失败，请重试。') }
    finally { setBusy(false) }
  }
  async function test() {
    setBusy(true); setNotice('正在检测解析组件…')
    try {
      const result = await window.yorw.parsers.test()
      if (result.ok) {
        setStatus(result.value); setForm(result.value.settings)
        const parts = result.value.components
        setNotice(`检测完成：Docling ${parts.docling.available ? `可用（${parts.docling.version}）` : '不可用'}；LibreOffice ${parts.libreoffice.available ? '可用' : '不可用'}。`)
      } else setNotice(messages[result.code] ?? '检测失败，请重试。')
    } catch { setNotice('检测失败，请重试。') }
    finally { setBusy(false) }
  }
  return <section className="provider"><h2>文献解析</h2>
    <p>默认使用内置解析。增强解析调用你自行安装的 Docling；Yorw 不随包附带、不自动下载或安装组件。Doc 还需要 LibreOffice。</p>
    {form && <fieldset disabled={busy}>
      <label className="check"><input aria-label="启用增强解析" type="checkbox" checked={form.enhanced_enabled} onChange={event => update('enhanced_enabled', event.target.checked)} />启用增强解析</label>
      <label>Docling 可执行文件<input aria-label="Docling 可执行文件" value={form.docling_executable} placeholder="例如 uv tool 安装后的 docling.exe 路径" onChange={event => update('docling_executable', event.target.value)} /></label>
      <label>启动参数（每行一个，可选）<textarea aria-label="Docling 启动参数" rows={2} value={form.docling_prefix.join('\n')} placeholder="使用 python -m docling 时填写两行：-m 和 docling" onChange={event => update('docling_prefix', event.target.value.split('\n').map(value => value.trim()).filter(Boolean))} /></label>
      <label>LibreOffice 可执行文件（留空自动检测）<input aria-label="LibreOffice 可执行文件" value={form.libreoffice_executable} placeholder="例如 C:\Program Files\LibreOffice\program\soffice.exe" onChange={event => update('libreoffice_executable', event.target.value)} /></label>
      <label>单文件解析超时（秒）<input aria-label="解析超时秒数" type="number" min={1} max={3600} value={form.timeout_seconds} onChange={event => update('timeout_seconds', Math.max(1, Math.min(3600, Number(event.target.value) || 1)))} /></label>
      <label className="check"><input aria-label="允许 OCR" type="checkbox" checked={form.ocr_enabled} onChange={event => update('ocr_enabled', event.target.checked)} />允许 OCR（扫描 PDF）</label>
      <label>OCR 模式<select aria-label="OCR 模式" value={form.ocr_mode} onChange={event => update('ocr_mode', event.target.value as ParserSettings['ocr_mode'])}><option value="default">默认（按版面区域）</option><option value="full_page">整页 OCR</option></select></label>
      <div className="actions"><button className="primary" onClick={() => void save()}>保存解析配置</button><button onClick={() => void test()}>检测组件能力</button></div>
    </fieldset>}
    {status && <div className="parser-status"><p>Docling：{status.components.docling.available ? `可用（${status.components.docling.version}）` : `不可用 · ${status.components.docling.detail}`}；LibreOffice：{status.components.libreoffice.available ? '可用' : '不可用'}。</p>
      <table className="parser-capabilities"><thead><tr><th>格式</th><th>内置</th><th>增强（Docling）</th></tr></thead><tbody>
        {parserFormats.map(format => {
          const builtin = status.capabilities.find(item => item.format === format && item.processor === 'builtin')
          const docling = status.capabilities.find(item => item.format === format && item.processor === 'docling')
          return <tr key={format}><th>{format}</th>
            <td>{builtin ? `${parserStateLabel[builtin.state]}${builtin.detail ? ` · ${builtin.detail}` : ''}` : '—'}</td>
            <td>{docling ? `${parserStateLabel[docling.state]}${docling.detail ? ` · ${docling.detail}` : ''}` : '—'}{docling?.install_hint && docling.state === 'component_missing' && <small>{docling.install_hint}</small>}</td>
          </tr>
        })}
      </tbody></table>
    </div>}
    <p role="status" className={notice && !notice.startsWith('检测完成') && !notice.endsWith('已保存。') ? 'failed' : ''}>{notice}</p>
  </section>
}

export function House({active=true}:{active?:boolean}) {
  const [configs, setConfigs] = useState<ProviderConfig[] | null>(null)
  const [notice, setNotice] = useState('正在加载配置…')
  async function load() {
    try { const result = await window.yorw.providers.list(); if (result.ok) { setConfigs(result.value); setNotice('') } else setNotice(messages[result.code] ?? '加载失败') }
    catch { setNotice('加载失败，请重试') }
  }
  useEffect(() => { void load() }, [])
  return <><AiSettings active={active}/><ParserPanel active={active}/><p>聊天与检索模型分别配置。密钥由系统安全存储加密。</p>{notice && <p role="status">{notice} <button onClick={() => void load()}>重新加载</button></p>}{configs && (['chat', 'embedding'] as ProviderKind[]).map(kind => <ProviderForm key={kind} kind={kind} saved={configs.find(config => config.kind === kind)} onSaved={saved => setConfigs(previous => [...(previous ?? []).filter(config => config.kind !== kind), saved])} />)}<WorkspacePanel active={active}/></>
}

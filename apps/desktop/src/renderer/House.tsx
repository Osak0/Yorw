import {EnrichmentSettingsPanel} from './EnrichmentPanel'
import React, { useEffect, useState } from 'react'
import type { ParserCapability, ParserSettings, ParserStatus, ProviderConfig, ProviderKind } from '../shared/status'
import {WorkspacePanel} from './WorkspacePanel'
import type {AiPreferences} from '../shared/status'

export const houseTitles:Record<string,string> = {parsers:'文献解析与预览',chat:'聊天模型',retrieval:'检索',data:'数据与导出'}
export const houseForms = new Map<string,{dirty:boolean;save:()=>Promise<boolean>}>()
function useHouseForm(id:string,dirty:boolean,save:()=>Promise<boolean>){
  useEffect(()=>{houseForms.set(id,{dirty,save});return()=>{houseForms.delete(id)}},[id,dirty,save])
}
const messages: Record<string, string> = {
  COMPONENT_APPROVAL_REQUIRED:'请重新选择并授权外部程序，然后保存。',
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
  useHouseForm(kind === 'chat' ? 'chat' : 'retrieval', url !== (saved?.base_url ?? '') || model !== (saved?.model ?? '') || !!key || clearKey, async()=>!!(await run(false)))
  const dirty = url !== saved?.base_url || model !== saved?.model || !!key || clearKey
  async function run(test: boolean):Promise<boolean> {
    setBusy(true); setNotice(test ? '正在测试连接…' : '正在保存…'); setError(false)
    try {
      if (test) {
        const result = await window.yorw.providers.test(kind)
        if (!result.ok) { setError(true); setNotice(messages[result.code] ?? '测试失败'); return false }
        setError(!result.value.ok)
        setNotice(messages[result.value.code] ?? '测试失败')
      } else {
        // Capture only in this submission; clear password state immediately.
        const request = { kind, base_url: url, model, key, clear_key: clearKey, version: saved?.version ?? 0 }
        setKey('')
        const result = await window.yorw.providers.save(request)
        request.key = ''
        if (!result.ok) { setError(true); setNotice(messages[result.code] ?? '保存失败，请重试'); return false }
        onSaved(result.value); setUrl(result.value.base_url); setModel(result.value.model); setClearKey(false)
        setNotice('配置已保存，连接状态尚待测试'); return true
      }
    } catch { setError(true); setNotice('操作失败，请重试；密钥需重新输入') }
    finally { setBusy(false) }
    return false
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
 async function change(enabled:boolean,metadata=saved?.metadata_enabled??false){if(!saved)return;setBusy(true);setNotice('')
  try{const result=await window.yorw.ai.savePreferences({...saved,semantic_enabled:enabled,metadata_enabled:metadata});if(result.ok){setSaved(result.value);setNotice('已保存。')}else setNotice(messages[result.code]??'设置未保存，请重试。')}
  catch{setNotice('设置未保存，请重试。')}finally{setBusy(false)}
 }
 return <section className="provider"><h2>检索</h2><label className="check"><input aria-label="语义检索" type="checkbox" checked={saved?.semantic_enabled??true} disabled={!saved||busy} onChange={event=>void change(event.target.checked)}/>语义检索</label><p>结合问题含义查找相关内容。关闭后使用本地文字匹配。</p><label className="check"><input aria-label="元数据辅助检索" type="checkbox" checked={saved?.metadata_enabled??false} disabled={!saved||busy} onChange={event=>void change(saved?.semantic_enabled??false,event.target.checked)}/>元数据辅助检索（试用）</label><p>使用标题、人工资料和未过期 AI 整理辅助查找，仍返回原文证据。固定夹具已通过，真实模型质量尚待评估，默认关闭。</p><p role="status">{notice}</p></section>
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
  useEffect(() => { void load() }, [])
  useHouseForm('parsers', !!form && JSON.stringify(form)!==JSON.stringify(status?.settings), async()=>!!(await save()))
  async function choose(component:'docling'|'libreoffice'){
    try {
      const result=await window.yorw.parsers.choose(component)
      if(!result.ok){setNotice(component==='docling'?'请选择已安装的 docling.exe，并在系统确认框中授权。':'请选择 LibreOffice 的 soffice.exe，并在系统确认框中授权。');return}
      if(result.value.cancelled){setNotice('已取消组件选择；内置导入与阅读仍可使用。');return}
      if(component==='docling'){update('docling_executable',result.value.path!);update('docling_prefix',result.value.prefix??[])}
      else update('libreoffice_executable',result.value.path!)
      setNotice('已选择并授权组件，请保存配置后检测。')
    }catch{setNotice('组件选择未完成；内置导入与阅读仍可使用。')}
  }
  function update<K extends keyof ParserSettings>(key: K, value: ParserSettings[K]) {
    setForm(previous => previous ? { ...previous, [key]: value } : previous)
  }
  async function save() {
    if (!form) return false
    setBusy(true); setNotice('正在保存解析配置…')
    try {
      const result = await window.yorw.parsers.save(form)
      if (result.ok) {
        setForm(result.value)
        setStatus(previous => previous ? { ...previous, settings: result.value } : previous)
        setNotice('解析配置已保存。'); return true
      } else setNotice(result.code === 'CONFIG_CONFLICT' ? '配置已更新，请重新加载后再保存。' : messages[result.code] ?? '保存失败，请重试。')
    } catch { setNotice('保存失败，请重试。') }
    finally { setBusy(false) }
    return false
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
    <p>PDF、DOCX、Markdown、TXT 的基础导入、阅读与文字检索无需外部解析组件。导入始终使用内置解析；Docling 只用于手动选择的增强解析/OCR，LibreOffice 只用于旧 DOC 处理与可选版式预览。Yorw 不随包附带或自动安装它们。</p>
    {form && <fieldset disabled={busy}>
      <label>Docling 程序<input readOnly value={form.docling_executable}/><button onClick={()=>void choose('docling')}>选择并授权 Docling</button><button onClick={()=>{update('docling_executable','');update('docling_prefix',[])}}>清除</button></label>
      <label>LibreOffice 程序<input readOnly value={form.libreoffice_executable}/><button onClick={()=>void choose('libreoffice')}>选择并授权 LibreOffice</button><button onClick={()=>update('libreoffice_executable','')}>清除</button></label>
      <p>首次配置或程序发生变化时，请选择并授权，然后保存；已授权且文件未变化的组件会在重启后恢复授权。普通状态查询不会运行程序。</p>
      <details><summary>高级解析设置</summary>
      <label>单文件解析超时（秒）<input aria-label="解析超时秒数" type="number" min={1} max={3600} value={form.timeout_seconds} onChange={event => update('timeout_seconds', Math.max(1, Math.min(3600, Number(event.target.value) || 1)))} /></label>
      <label className="check"><input aria-label="允许 OCR" type="checkbox" checked={form.ocr_enabled} onChange={event => update('ocr_enabled', event.target.checked)} />允许 OCR（扫描 PDF）</label>
      <label>OCR 模式<select aria-label="OCR 模式" value={form.ocr_mode} onChange={event => update('ocr_mode', event.target.value as ParserSettings['ocr_mode'])}><option value="default">默认（按版面区域）</option><option value="full_page">整页 OCR</option></select></label>
      <label>OCR 引擎<select aria-label="OCR 引擎" value={form.ocr_engine} onChange={event => update('ocr_engine', event.target.value as ParserSettings['ocr_engine'])}><option value="auto">自动（Docling 选择）</option><option value="easyocr">EasyOCR</option><option value="rapidocr">RapidOCR（无需 GitHub 模型下载）</option><option value="tesseract">Tesseract</option></select></label>
      </details><div className="actions"><button className="primary" onClick={() => void save()}>保存解析配置</button><button disabled={JSON.stringify(form)!==JSON.stringify(status?.settings)} onClick={() => void test()}>检测组件能力</button></div>
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

export function House({active=true, page, onOpen}:{active?:boolean;page?:string;onOpen?:(id:string)=>void}) {
  const [configs, setConfigs] = useState<ProviderConfig[] | null>(null)
  const [notice, setNotice] = useState('正在加载配置…')
  async function load() {
    try { const result = await window.yorw.providers.list(); if (result.ok) { setConfigs(result.value); setNotice('') } else setNotice(messages[result.code] ?? '加载失败') }
    catch { setNotice('加载失败，请重试') }
  }
  useEffect(() => { void load() }, [])
  if(!page)return <div className="house-entries">{Object.entries(houseTitles).map(([id,title])=><button key={id} onClick={()=>onOpen?.(id)}><strong>{title}</strong><small>{id==='parsers'?'内置解析、外部组件、OCR 与原件预览':id==='chat'?'聊天服务与连接测试':id==='retrieval'?'语义检索、Embedding 服务与测试':'数据位置与已保存内容导出'}</small></button>)}</div>
  return <>{page==='parsers'&&<><ParserPanel active={active}/><EnrichmentSettingsPanel/></>} {page==='retrieval'&&<AiSettings active={active}/>}{notice&&<p role="status">{notice}</p>}{configs&&(page==='chat'||page==='retrieval')&&<ProviderForm kind={page==='chat'?'chat':'embedding'} saved={configs.find(config=>config.kind===(page==='chat'?'chat':'embedding'))} onSaved={saved=>setConfigs(previous=>[...(previous??[]).filter(config=>config.kind!==saved.kind),saved])}/>} {page==='data'&&<WorkspacePanel active={active}/>}</>
}

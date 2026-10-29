import { readFile, writeFile, rename } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dialog } from 'electron'
import { basename } from 'node:path'
import type { Backend } from './backend'

/** Parser settings contain paths, never secrets; validation stays in main. */
export class Parsers {
  private approved = new Set<string>()
  constructor(private backend: Backend, private approvalFile?: string) {}
  private async fingerprint(path:string) { return createHash('sha256').update(await readFile(path)).digest('hex') }
  private async remember(component:string,path:string) {
    if(!this.approvalFile)return
    let entries:Record<string,string>={}
    try{entries=JSON.parse(await readFile(this.approvalFile,'utf8'))}catch{}
    entries[`${component}:${path}`]=await this.fingerprint(path)
    const temporary=`${this.approvalFile}.${randomUUID()}.tmp`
    await writeFile(temporary,JSON.stringify(entries),{flag:'wx'})
    await rename(temporary,this.approvalFile)
  }
  private async restore(settings:any) {
    if(!this.approvalFile)return false
    let entries:Record<string,string>
    try{entries=JSON.parse(await readFile(this.approvalFile,'utf8'))}catch{return false}
    for(const component of ['docling','libreoffice']){
      const path=settings[`${component}_executable`]
      if(!path)continue
      const key=`${component}:${path}`
      try{if(entries[key]!==await this.fingerprint(path))return false}catch{return false}
      this.approved.add(key)
    }
    const prefix=/^python/i.test(basename(settings.docling_executable??''))?['-m','docling']:[]
    return JSON.stringify(settings.docling_prefix)===JSON.stringify(prefix)
  }
  async choose(component: unknown) {
    if (component !== 'docling' && component !== 'libreoffice') throw new Error('INVALID_INPUT')
    const result = await dialog.showOpenDialog({ title: `选择并授权 ${component} 程序`, properties: ['openFile'], filters: [{name:'可执行程序',extensions:['exe']}] })
    const path = result.filePaths[0]
    if (result.canceled || !path) return { cancelled: true }
    const allowed = component === 'docling' ? /^(docling|python|python3)\.exe$/i : /^soffice\.exe$/i
    if (!allowed.test(basename(path))) throw new Error('INVALID_INPUT')
    const confirmation = await dialog.showMessageBox({ type: 'question', message: `允许 Yorw 运行此 ${component} 程序？`, detail: path, buttons: ['取消', '允许'], defaultId: 0, cancelId: 0 })
    if (confirmation.response !== 1) return { cancelled: true }
    await this.remember(component,path)
    this.approved.add(`${component}:${path}`)
    return { cancelled: false, path, prefix: /^python/i.test(basename(path)) ? ['-m','docling'] : [] }
  }

  async status() {
    const result=await this.backend.request('/v1/parsers')
    if(await this.restore(result.settings)){const {singleton,...settings}=result.settings;await this.backend.request('/v1/parsers/approve','POST',settings)}
    return result
  }

  test() {
    return this.backend.request('/v1/parsers/test', 'POST', {})
  }

  save(input: any) {
    if (!input || typeof input.enhanced_enabled !== 'boolean' || typeof input.ocr_enabled !== 'boolean'
      || typeof input.version !== 'number' || !Number.isInteger(input.version) || input.version < 0
      || typeof input.docling_executable !== 'string' || input.docling_executable.length > 1000
      || typeof input.libreoffice_executable !== 'string' || input.libreoffice_executable.length > 1000
      || !Array.isArray(input.docling_prefix) || input.docling_prefix.length > 16
      || input.docling_prefix.some((item: unknown) => typeof item !== 'string' || item.length > 200)
      || typeof input.timeout_seconds !== 'number' || input.timeout_seconds < 1 || input.timeout_seconds > 3600
      || !['default', 'full_page'].includes(input.ocr_mode)
      || !['auto', 'easyocr', 'rapidocr', 'tesseract'].includes(input.ocr_engine)) throw new Error('INVALID_INPUT')
    if ((!this.approved.has(`docling:${input.docling_executable}`) && input.docling_executable) || (!this.approved.has(`libreoffice:${input.libreoffice_executable}`) && input.libreoffice_executable)) throw new Error('COMPONENT_APPROVAL_REQUIRED')
    const prefix = /^python/i.test(basename(input.docling_executable)) ? ['-m', 'docling'] : []
    if (JSON.stringify(input.docling_prefix) !== JSON.stringify(prefix)) throw new Error('INVALID_INPUT')
    return this.backend.request('/v1/parsers', 'PUT', {
      approved: true,
      enhanced_enabled: input.enhanced_enabled,
      docling_executable: input.docling_executable,
      docling_prefix: input.docling_prefix,
      libreoffice_executable: input.libreoffice_executable,
      timeout_seconds: input.timeout_seconds,
      ocr_enabled: input.ocr_enabled,
      ocr_mode: input.ocr_mode,
      ocr_engine: input.ocr_engine,
      version: input.version,
    })
  }
}

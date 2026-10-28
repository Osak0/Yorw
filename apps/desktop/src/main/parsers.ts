import type { Backend } from './backend'

/** Parser settings contain paths, never secrets; validation stays in main. */
export class Parsers {
  constructor(private backend: Backend) {}

  status() {
    return this.backend.request('/v1/parsers')
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
    return this.backend.request('/v1/parsers', 'PUT', {
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

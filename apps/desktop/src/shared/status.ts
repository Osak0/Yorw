export interface AppStatus { state: 'starting' | 'ready' | 'failed'; message: string; code?: string }
export interface DesktopBridge { getStatus(): Promise<AppStatus>; providers: { list(): Promise<Result<ProviderConfig[]>>; save(input: ProviderInput): Promise<Result<ProviderConfig>>; test(kind: ProviderKind): Promise<Result<ProbeResult>> } }

export type ProviderKind = 'chat' | 'embedding'
export interface ProviderConfig { kind: ProviderKind; base_url: string; model: string; version: number; has_key?: boolean; key_error?: boolean }
export interface ProviderInput extends ProviderConfig { key?: string; clear_key?: boolean }
export interface ProbeResult { ok: boolean; code: string; dimension?: number }
export type Result<T> = { ok: true; value: T } | { ok: false; code: string }

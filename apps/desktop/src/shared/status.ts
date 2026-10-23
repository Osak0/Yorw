export interface AppStatus { state: 'starting' | 'ready' | 'failed'; message: string; code?: string }
export interface DesktopBridge { getStatus(): Promise<AppStatus> }

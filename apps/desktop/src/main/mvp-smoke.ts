/** Current continuous workflow; historical v0.1 evidence remains in its release. */
import type {BrowserWindow} from 'electron'
import type {Backend} from './backend'
import type {Providers} from './providers'
import {runAiWorkflowSmoke,resumeAiWorkflowSmoke} from './ai-workflow-smoke'

export function runMvpSmoke(window:BrowserWindow,backend:Backend,providers:Providers,reportDir:string){
 return runAiWorkflowSmoke(window,backend,providers,reportDir,true)
}
export function resumeMvpSmoke(window:BrowserWindow,backend:Backend,reportDir:string){
 return resumeAiWorkflowSmoke(window,backend,reportDir)
}

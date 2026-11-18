import type {ResearchScope} from '../shared/status'
export const RESEARCH_TAB_ID='00000000-0000-4000-8000-000000000002'
let pending={sequence:0,question:'',scope:{mode:'workspace'} as ResearchScope}
let consumed=0
export function researchLaunch(){
 if(pending.sequence<=consumed)return null
 consumed=pending.sequence
 return pending
}
export function openResearch(question='',scope:ResearchScope={mode:'workspace'}){pending={sequence:pending.sequence+1,question,scope};window.dispatchEvent(new Event('research-open'))}

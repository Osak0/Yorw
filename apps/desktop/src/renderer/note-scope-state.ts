import type {NoteScope} from '../shared/status'
export const scopeDrafts=new Map<string,{view:NoteScope;rules:Record<string,boolean>;save?:()=>Promise<boolean>}>()
export const dirtyScope=(id:string)=>{const d=scopeDrafts.get(id);return !!d&&JSON.stringify(d.rules)!==JSON.stringify(d.view.rules)}
export const dirtyScopeIds=()=>[...scopeDrafts.keys()].filter(dirtyScope)

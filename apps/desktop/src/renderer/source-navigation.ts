import {createContext} from 'react'
import type {ReaderTarget} from '../shared/status'
export const SourceNavigationContext=createContext<(documentId:string,target:ReaderTarget)=>void>(()=>{})

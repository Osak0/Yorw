import React from 'react'
/** Local decorative icons; names stay in the visible setting labels. */
export function SettingsIcon({kind}:{kind:string}){
 const paths:Record<string,React.ReactNode>={
  parsers:<><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5M10 12h5M10 16h5"/></>,
  chat:<><path d="M4 4h16v12H9l-5 4z"/><path d="M8 8h8M8 12h5"/></>,
  retrieval:<><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6M10 7v6"/></>,
  data:<><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/></>
 }
 return <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>
}

import {expect,test} from 'vitest'
import {normalizePdfQuote,highlightPdfQuote} from '../src/renderer/pdf-highlight'

test('PDF matching tolerates extraction line breaks, hyphens and ligatures',()=>{
 expect(normalizePdfQuote('comprehen-\nsive ﬁnding')).toBe(normalizePdfQuote('Comprehensive finding'))
 const spans=['A comprehen-','sive ﬁnding.'].map(text=>({textContent:text,style:{backgroundColor:''},classList:{add(){}}}))
 const host={querySelectorAll:()=>spans} as unknown as HTMLElement
 expect(highlightPdfQuote(host,'comprehensive finding')).toBe(true)
 expect(spans.every(s=>s.style.backgroundColor)).toBe(true)
 expect(highlightPdfQuote(host,'absent quote')).toBe(false)
})

test('ambiguous PDF excerpts are not highlighted as a unique match',()=>{
 const host={querySelectorAll:()=>[{textContent:'same same'}]} as unknown as HTMLElement
 expect(highlightPdfQuote(host,'same')).toBe(false)
})

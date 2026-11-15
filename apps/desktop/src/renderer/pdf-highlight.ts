/** PDF extractors split words/ligatures differently; retain span offsets for display. */
export function normalizePdfQuote(text:string){return text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\u00ad‐‑‒–—-]/gu,'')}
export function highlightPdfQuote(container:HTMLElement,quote:string){
 const needle=normalizePdfQuote(quote),spans=[...container.querySelectorAll('span')]
 const parts=spans.map(span=>normalizePdfQuote(span.textContent??'')),joined=parts.join('')
 const start=needle?joined.indexOf(needle):-1
 if(start<0||joined.indexOf(needle,start+1)>=0)return false
 let offset=0
 spans.forEach((span,index)=>{const end=offset+parts[index].length;if(offset<start+needle.length&&end>start){span.classList.add('pdf-evidence-highlight');span.style.backgroundColor='rgba(255,220,80,.55)'}offset=end})
 return true
}

import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {expect,test} from 'vitest'
import {ResearchComposer} from '../src/renderer/ResearchComposer'

test('shared composer exposes multiline editing, scope controls and expansion',()=>{
 const html=renderToStaticMarkup(<ResearchComposer value={'第一段\n第二段'} onChange={()=>{}} onSend={()=>{}} label="研究问题" placeholder="输入" controls={<select aria-label="范围"><option>工作区</option></select>}/> )
 expect(html).toContain('rows="3"');expect(html).toContain('第一段\n第二段');expect(html).toContain('maxLength="4000"');expect(html).toContain('展开输入');expect(html).toContain('aria-label="范围"')
})
test('empty and busy drafts cannot submit and length appears only near limit',()=>{
 const render=(value:string,disabled=false)=>renderToStaticMarkup(<ResearchComposer value={value} disabled={disabled} onChange={()=>{}} onSend={()=>{}} label="问题" placeholder="输入"/>)
 expect(render('  ')).toContain('disabled=""');expect(render('保留草稿',true)).toContain('disabled=""');expect(render('短输入')).not.toContain('/4000');expect(render('字'.repeat(3600))).toContain('3600/4000')
})


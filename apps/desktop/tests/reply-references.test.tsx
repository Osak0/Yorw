import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {expect,test} from 'vitest'
import {ReplyReferences} from '../src/renderer/ReplyReferences'

test('verified reply entries use named detail cards rather than visible internal IDs',()=>{
 const id='12345678-1234-4234-8234-123456789abc'
 const html=renderToStaticMarkup(<ReplyReferences items={[{kind:'folder',id,title:'新生杯',path:'活动/新生杯'},{kind:'topic',id,title:'研究专题'}]}/>)
 expect(html).toContain('Storage 目录');expect(html).toContain('打开详情');expect(html).toContain('活动/新生杯');expect(html).toContain('研究专题');expect(html).not.toContain(id)
})
test('a reading note card names its document and opens through the note route',()=>{
 const id='12345678-1234-4234-8234-123456789abc',document_id='22345678-1234-4234-8234-123456789abc'
 const html=renderToStaticMarkup(<ReplyReferences items={[{kind:'reading_note',id,title:'《决算单》阅读笔记',document_id}]}/>)
 expect(html).toContain('阅读笔记');expect(html).toContain('《决算单》阅读笔记');expect(html).toContain('打开详情')
 expect(html).not.toContain(id)
})
test('an answer without verified references has no invented detail cards',()=>{
 expect(renderToStaticMarkup(<ReplyReferences items={[]}/>)).toBe('')
})

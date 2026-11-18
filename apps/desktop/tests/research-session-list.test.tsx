import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {expect,test} from 'vitest'
import {ResearchSessionList,groupSessions} from '../src/renderer/ResearchSessionList'
import type {ResearchSession} from '../src/shared/status'

const session=(id:string,partition:string,title=id):ResearchSession=>({id,title,partition,scope:{mode:'workspace',topic_id:null},version:1,archived:0,created_at:'2026-11-17',updated_at:'2026-11-17T10:00:00Z'})

const render=(sessions:ResearchSession[])=>renderToStaticMarkup(<ResearchSessionList sessions={sessions} selected={null} archived={false} onOpen={()=>{}} onRename={async()=>true} onPartition={async()=>true} onRenamePartition={async()=>true} onRemovePartition={async()=>true} onArchive={()=>{}} onRemove={()=>{}}/>)

test('sessions group by partition and keep the unfiled group last',()=>{
 const groups=groupSessions([session('a','金融'),session('b',''),session('c','比赛')])
 expect(groups.map(([name])=>name)).toEqual(['比赛','金融',''])
 expect(groups[2][1].map(item=>item.id)).toEqual(['b'])
})

test('partitions read as folders with a create entry and a scoped explanation',()=>{
 const html=render([session('a','金融','金融会话'),session('b','','未归档会话')])
 expect(html).toContain('新建分区');expect(html).toContain('分区说明')
 expect(html).toContain('aria-expanded="false"')
 expect(html).not.toContain('按分区筛选会话')
})

test('each folder exposes expand, enter and manage affordances',()=>{
 const html=render([session('a','金融','金融会话'),session('b','','未归档会话')])
 expect(html).toContain('aria-expanded="true"')
 expect(html).toContain('收起 金融')
 expect(html).toContain('管理分区 金融')
 expect(html).toContain('双击进入')
 expect(html).toContain('金融会话');expect(html).toContain('管理会话 金融会话')
 expect(html).toContain('收起 未分区')
 expect(html).toContain('未归档会话')
})

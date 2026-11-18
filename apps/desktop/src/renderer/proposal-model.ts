import type {CollaborationProposal, ProposalOperation} from '../shared/status'

export const proposalLabels: Record<string, string> = {
  create_topic: '新建专题', create_note: '新增笔记', append_note: '追加笔记',
  rewrite_note: '重写笔记', link: '建立关系', unlink: '解除关系',
}
export const proposalStatus: Record<string, string> = {
  pending: '待采纳', accepted: '已采纳', rejected: '已拒绝', undone: '已撤回',
}
export const proposalErrors: Record<string, string> = {
  PROPOSAL_STALE: '资料、范围或研究背景已变化，此方案需要重新预览。',
  PROPOSAL_CONFLICT: '方案状态已变化，请重新载入。',
  SOURCE_UNAVAILABLE: '来源已失效，请重新核对资料后生成。',
  UNDO_CONFLICT: '成果已有后续修改，整组撤回已停止，修改已保留。',
  UNDO_DEPENDENCY: '成果已被其他资料引用，不能直接删除。',
  RESEARCH_AGAIN_REQUIRED: '背景或来源已变化，请重新发起研究，再生成方案。',
  EMPTY_SELECTION: '请选择至少一个不缺少前置项的操作。',
  REWRITE_NOT_EXPLICIT: '重写需要明确指定笔记并提出重写要求。',
  OUT_OF_SCOPE: '操作对象不在当前研究范围。',
  INVALID_DEPENDENCY: '方案中的前置引用无效，请重新预览。',
}
export const proposalExplain = (code: string) => proposalErrors[code] ?? `操作未完成（${code}），正式资料保持原样。`

const sideName = (op: ProposalOperation, side: 'first' | 'second') =>
  (side === 'first' ? op.first_title : op.second_title) || (side === 'first' ? op.first : op.second) || '未命名对象'

export function proposalOperationName(op: ProposalOperation): string {
  if (op.action === 'create_topic' || op.action === 'create_note') return op.title || '未命名成果'
  if (op.action === 'append_note' || op.action === 'rewrite_note') return op.target_title || op.target || '指定笔记'
  return `${sideName(op, 'first')} 与 ${sideName(op, 'second')}`
}

export function proposalTitle(item: Pick<CollaborationProposal, 'operations'>): string {
  const first = item.operations[0]
  return first ? `${proposalLabels[first.action] ?? '修改'}：${proposalOperationName(first)}` : '资料修改方案'
}

/** Operations arrive in prerequisite order, as validated by the preview service. */
export function selectProposalOperation(
  operations: Pick<CollaborationProposal['operations'][number], 'key' | 'depends_on'>[],
  selected: string[], key: string, checked: boolean,
): string[] {
  const next = new Set(selected)
  if (checked) {
    const required = new Set([key])
    for (const op of [...operations].reverse()) if (required.has(op.key)) for (const dep of op.depends_on) required.add(dep)
    for (const requiredKey of required) next.add(requiredKey)
  } else {
    next.delete(key)
    for (const op of operations) if (op.depends_on.some(dep => !next.has(dep))) next.delete(op.key)
  }
  return operations.filter(op => next.has(op.key)).map(op => op.key)
}

/** Explicitly requested operations start selected; extra recommendations start unselected. */
export function defaultProposalSelection(operations: CollaborationProposal['operations']): string[] {
  const requested = operations.filter(operation => !operation.recommended).map(operation => operation.key)
  return requested.reduce((selection, key) => selectProposalOperation(operations, selection, key, true), [] as string[])
}

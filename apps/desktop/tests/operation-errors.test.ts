import {test,expect} from 'vitest'
import {operationError} from '../src/main/operation-errors'
test('missing optional components and preview statuses remain actionable across IPC',()=>{
 for(const code of ['COMPONENT_APPROVAL_REQUIRED','COMPONENT_MISSING','PREVIEW_NOT_READY','PREVIEW_FAILED','CANCELLED'])expect(operationError(new Error(code))).toBe(code)
})
test('private errors never leak paths, keys or stacks',()=>{
 expect(operationError(new Error('private path and credentials'))).toBe('OPERATION_FAILED')
 expect(operationError('COMPONENT_MISSING')).toBe('OPERATION_FAILED')
})

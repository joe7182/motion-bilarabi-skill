import { describe, expect, it } from 'vitest'
import { codeFileParams, permissionPromptParams } from '../../src/core/params/devtools'

describe('dev-tool explainers (permission-prompt, code-file)', () => {
  it('permission-prompt: defaults to «Yes, and don’t ask again»; option is 0..2', () => {
    expect(permissionPromptParams.parse({ command: 'npm run dev' }).option).toBe(1)
    expect(() => permissionPromptParams.parse({ command: 'ls', option: 3 })).toThrow()
  })
  it('code-file: marks are add / secret / ok; at most 14 lines', () => {
    expect(codeFileParams.parse({ file: '.env', lines: [{ text: 'KEY=1', at: 0, mark: 'secret', tag: 'مفتاح!' }] }).lines[0]!.mark).toBe('secret')
    expect(() => codeFileParams.parse({ file: '.env', lines: [{ text: 'x', at: 0, mark: 'bad' }] })).toThrow()
    expect(() => codeFileParams.parse({ file: '.env', lines: Array.from({ length: 15 }, () => ({ text: 'x', at: 0 })) })).toThrow()
  })
})

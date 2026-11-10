import { describe, expect, it } from 'vitest'
import { loadedDieParams, serverBatchParams, tokenOddsParams, tokenStreamParams } from '../../src/core/params/odds'

describe('odds explainers (token-stream, token-odds, loaded-die, server-batch)', () => {
  it('token-stream: pieces default to not joined; at most 24 tokens', () => {
    expect(tokenStreamParams.parse({ tokens: [{ text: 'الاصط', at: 0, joinNext: true }, { text: 'ناعي', at: 0.3 }] }).tokens[1]!.joinNext).toBe(false)
    expect(() => tokenStreamParams.parse({ tokens: Array.from({ length: 25 }, (_, i) => ({ text: 'x', at: i })) })).toThrow()
  })
  it('token-odds: the pick must name an existing option', () => {
    const options = [{ text: 'أ', p: 0.6 }, { text: 'ب', p: 0.4 }]
    expect(tokenOddsParams.parse({ prompt: 'هو', options, pick: { at: 1, index: 1 } }).temps).toEqual([])
    expect(() => tokenOddsParams.parse({ prompt: 'هو', options, pick: { at: 1, index: 3 } })).toThrow()
  })
  it('loaded-die: exactly six faces', () => {
    expect(() => loadedDieParams.parse({ faces: ['أ', 'ب'] })).toThrow()
    expect(loadedDieParams.parse({ faces: ['أ', 'أ', 'أ', 'ب', 'ب', 'ج'] }).legend).toBe(true)
  })
  it('server-batch: two to four questions, yours first', () => {
    expect(() => serverBatchParams.parse({ questions: ['س'], answer: ['أ', 'ب'], changed: ['ج', 'د'] })).toThrow()
    expect(serverBatchParams.parse({ questions: ['س', 'ص'], answer: ['أ', 'ب'], changed: ['ج', 'د'] }).flipAt).toBe(2.6)
  })
})

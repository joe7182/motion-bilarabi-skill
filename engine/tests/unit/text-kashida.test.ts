import { describe, it, expect } from 'vitest'
import { hasArabic, isStretchable, kashidaSlots, splitWords, stretchArabic, KASHIDA_MAX_PER_SLOT, MAX_TATWEEL } from '../../src/core/text'

const TATWEEL = 'ـ'
const count = (s: string) => [...s].filter((c) => c === TATWEEL).length

describe('kashidaSlots', () => {
  it('lists the joining gaps of a plain word, never after the non-joining last letter', () => {
    expect(kashidaSlots('تمدد')).toEqual([0, 1])
  })
  it('is empty when no letter joins its successor or the word is not Arabic', () => {
    expect(kashidaSlots('درود')).toEqual([])
    expect(kashidaSlots('motion')).toEqual([])
    expect(kashidaSlots('لا')).toEqual([])
    expect(kashidaSlots('ى')).toEqual([])
    expect(kashidaSlots('م')).toEqual([])
  })
  it('skips lam-alef', () => {
    expect(kashidaSlots('سلام')).toEqual([0])
  })
  it('puts the slot after the marks, never between a base letter and its harakat', () => {
    expect(kashidaSlots('مَرْحَبًا')).toEqual([1, 5, 7])
  })
  it('isStretchable mirrors the slots', () => {
    expect(isStretchable('تمدد')).toBe(true)
    expect(isStretchable('درود')).toBe(false)
    expect(isStretchable('AI')).toBe(false)
  })
})

describe('stretchArabic', () => {
  it('fills the middle slot first, then alternates outward', () => {
    expect(stretchArabic('تمدد', 3)).toBe('تـمــدد')
  })
  it('leaves unstretchable words and n = 0 alone', () => {
    expect(stretchArabic('درود', 5)).toBe('درود')
    expect(stretchArabic('تمدد', 0)).toBe('تمدد')
  })
  it('is idempotent on an already stretched word', () => {
    const once = stretchArabic('تمدد', 3)
    expect(stretchArabic(once, 3)).toBe(once)
    expect(stretchArabic(once, 0)).toBe(once)
  })
  it('caps each slot at KASHIDA_MAX_PER_SLOT and the total at MAX_TATWEEL', () => {
    expect(KASHIDA_MAX_PER_SLOT).toBe(4)
    expect(MAX_TATWEEL).toBe(12)
    expect(count(stretchArabic('تمدد', 99))).toBe(8)
    expect(count(stretchArabic('بسيطةجدا', 99))).toBe(MAX_TATWEEL)
  })
  it('round-robins: no slot holds more while another has none', () => {
    const w = stretchArabic('تمدد', 2)
    expect(w).toBe('تـمـدد')
  })
  it('keeps the stretched word a single Arabic word', () => {
    const w = stretchArabic('تمدد', 3)
    expect(splitWords(w)).toHaveLength(1)
    expect(hasArabic(w)).toBe(true)
  })
})

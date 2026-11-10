import { describe, expect, it } from 'vitest'
import {
  cuesOfGaugeRing, cuesOfNotifyStack, cuesOfStatBars, decimalsOf, fmtNumber, gaugeRingParams, liveTimerParams, notifyStackParams, statBarsParams, timerText,
} from '../../src/core/params/data-fx'

describe('number and timer text', () => {
  it('formats Arabic and Latin digits', () => {
    expect(fmtNumber(45, 0, 'arabic')).toBe('٤٥')
    expect(fmtNumber(12.5, 1, 'arabic')).toBe('١٢٫٥')
    expect(fmtNumber(12.5, 1, 'latin')).toBe('12.5')
    expect(decimalsOf(3)).toBe(0)
    expect(decimalsOf(3.5)).toBe(1)
    expect(decimalsOf(3.25)).toBe(2)
  })
  it('writes timers in every format', () => {
    expect(timerText(75.42, 'mm:ss', 'latin')).toBe('01:15')
    expect(timerText(75.42, 'mm:ss.cc', 'latin')).toBe('01:15.42')
    expect(timerText(3725, 'hh:mm:ss', 'latin')).toBe('01:02:05')
    expect(timerText(9, 'mm:ss', 'arabic')).toBe('٠٠:٠٩')
    expect(timerText(-3, 'mm:ss', 'latin')).toBe('00:00')
  })
})

describe('data params', () => {
  it('notify-stack fills defaults and cues a pop per card', () => {
    const p = notifyStackParams.parse({ items: [{ app: 'واتساب', title: 'طلب جديد', at: 0.2 }, { app: 'البنك', title: 'تم الدفع', at: 1 }] })
    expect(p.items[0]!.time).toBe('الآن')
    expect(p.show).toBe(3)
    expect(cuesOfNotifyStack(p).map((c) => c.t)).toEqual([0.2, 1])
    expect(notifyStackParams.safeParse({ items: [{ app: 'أ', title: 'ب', at: 0, tint: 'red' }] }).success).toBe(false)
  })
  it('stat-bars staggers a tick per row', () => {
    const p = statBarsParams.parse({ rows: [{ label: 'القص', value: 45 }, { label: 'الصوت', value: 20 }], at: 0.3, stagger: 0.2 })
    expect(cuesOfStatBars(p).map((c) => c.t)).toEqual([0.3, 0.5])
    expect(statBarsParams.safeParse({ rows: [{ label: 'أ', value: -1 }] }).success).toBe(false)
  })
  it('gauge-ring stays within 0–100', () => {
    expect(gaugeRingParams.safeParse({ value: 120 }).success).toBe(false)
    const p = gaugeRingParams.parse({ value: 87, at: 0.2, dur: 1.5 })
    expect(cuesOfGaugeRing(p)).toEqual([{ t: 1.7, kind: 'final' }])
  })
  it('live-timer defaults to Latin mm:ss', () => {
    const p = liveTimerParams.parse({ from: 10, to: 0, dur: 2 })
    expect(p.format).toBe('mm:ss')
    expect(p.digits).toBe('latin')
  })
})

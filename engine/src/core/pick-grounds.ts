import type { VariantId } from './variants'

/**
 * Backgrounds the style picker offers for a faceless video (no person on screen): each one is a look
 * (and colour variant) with the scene that fills track 0. Their ids match the title styles, so a
 * style card shows its title on its own background; the person can still mix them.
 */
export interface PickGround {
  id: string
  ar: string
  look: 'nebula' | 'signature' | 'dark-tech' | 'swiss-red'
  variant?: VariantId
  scene: { type: 'hue-field' | 'backdrop'; params: Record<string, unknown> }
  /** Title colours for this ground's own style when that style is drawn for video (light letters): dark ink on a light ground. */
  ink?: { text: string; k1: string; k2: string; box: string; boxAlpha: number }
}

export const PICK_GROUNDS: readonly PickGround[] = [
  { id: 'nebula', ar: 'نيبولا', look: 'nebula', scene: { type: 'hue-field', params: {} } },
  { id: 'electric', ar: 'أزرق كهربائي', look: 'nebula', variant: 'electric', scene: { type: 'hue-field', params: {} } },
  { id: 'coral', ar: 'كورال', look: 'nebula', variant: 'coral', scene: { type: 'hue-field', params: {} } },
  { id: 'cream', ar: 'كريمي', look: 'signature', scene: { type: 'backdrop', params: {} } },
  { id: 'tech', ar: 'داكن تقني', look: 'dark-tech', scene: { type: 'backdrop', params: {} } },
  { id: 'swiss', ar: 'سويسري', look: 'swiss-red', scene: { type: 'backdrop', params: {} }, ink: { text: '#111111', k1: '#cf1f17', k2: '#cf1f17', box: '#efede8', boxAlpha: 0 } },
]

export const groundOf = (id: unknown): PickGround => PICK_GROUNDS.find((g) => g.id === id) ?? PICK_GROUNDS[0]!

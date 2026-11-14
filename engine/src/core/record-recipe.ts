import { z } from 'zod'

/**
 * `mba record <recipe.json>`: clean footage of a web tool (the person's own page or app), shot by
 * shot. Each shot first runs its `setup` steps (off camera), then records `seconds` of video while
 * one `move` plays out smoothly (a drag that orbits a 3D view, a slider swept from one value to
 * another, a slow scroll, words typed letter by letter), or holds still when there is no move.
 * Frames are captured one by one, so the footage is smooth however slow the page is.
 */

const point = z.tuple([z.number(), z.number()])

/** An off-camera step before a shot. A target is a CSS selector or, failing that, an element's exact visible text. */
export const recordStepSchema = z.union([
  z.object({ click: z.string().min(1) }).strict(),
  /** Ticks (or unticks) the checkbox of the label containing this text. */
  z.object({ check: z.string().min(1), on: z.boolean().default(true) }).strict(),
  /** Sets an input's value and fires input + change (a slider, a number field, a select). */
  z.object({ set: z.string().min(1), value: z.union([z.string(), z.number()]) }).strict(),
  z.object({ scrollTo: z.string().min(1) }).strict(),
  /** Scrolls the page (or the element under `at`) to this many px from the top. */
  z.object({ scrollTop: z.number().min(0) }).strict(),
  z.object({ wait: z.number().min(0).max(30000) }).strict(),
])
export type RecordStep = z.infer<typeof recordStepSchema>

/** What moves while a shot records (eased in and out over the shot). */
export const recordMoveSchema = z.union([
  /** Mouse held down from `from` to `to` (viewport px): orbit a 3D view, pan a map, drag a card. */
  z.object({ drag: z.object({ from: point, to: point }).strict() }).strict(),
  /** An input's value swept from `from` to `to` (a time-of-day slider, a budget slider). */
  z.object({ sweep: z.object({ target: z.string().min(1), from: z.number(), to: z.number(), step: z.number().positive().optional() }).strict() }).strict(),
  /** Scrolls by `by` px (mouse wheel at `at`, default the viewport centre). */
  z.object({ scroll: z.object({ by: z.number(), at: point.optional() }).strict() }).strict(),
  /** Types `text` into `target` letter by letter across the shot. */
  z.object({ type: z.object({ target: z.string().min(1), text: z.string().min(1) }).strict() }).strict(),
  /** The pointer glides from `from` to `to` (hover effects, a cursor pointing at something). */
  z.object({ hover: z.object({ from: point, to: point }).strict() }).strict(),
])
export type RecordMove = z.infer<typeof recordMoveSchema>

export const recordShotSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'),
    seconds: z.number().min(0.2).max(60),
    setup: z.array(recordStepSchema).default([]),
    move: recordMoveSchema.optional(),
  })
  .strict()
export type RecordShot = z.infer<typeof recordShotSchema>

export const recordRecipeSchema = z
  .object({
    /** http(s) address or a local .html file (absolute, or relative to the recipe). */
    url: z.string().min(1),
    viewport: z.object({ w: z.number().int().min(320).max(2560), h: z.number().int().min(320).max(2560) }).strict().default({ w: 1280, h: 960 }),
    /** Device pixel ratio (1.5 keeps text crisp inside a zoomed screen-clip). */
    scale: z.number().min(1).max(3).default(1.5),
    fps: z.union([z.literal(25), z.literal(30), z.literal(60)]).default(25),
    /** Wait after the page loads (ms). */
    wait: z.number().min(0).max(30000).default(2500),
    shots: z.array(recordShotSchema).min(1),
  })
  .strict()
  .superRefine((r, ctx) => {
    const seen = new Set<string>()
    r.shots.forEach((s, i) => {
      if (seen.has(s.name)) ctx.addIssue({ code: 'custom', path: ['shots', i, 'name'], message: `shot name "${s.name}" is used twice` })
      seen.add(s.name)
    })
  })
export type RecordRecipe = z.infer<typeof recordRecipeSchema>

/** Smooth start and stop (sine in-out) for a move's progress 0…1. */
export const easeMove = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)))

/** Frame count of a shot at `fps`. */
export const shotFrames = (seconds: number, fps: number): number => Math.max(1, Math.round(seconds * fps))

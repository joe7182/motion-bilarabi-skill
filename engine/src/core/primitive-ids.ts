import { PARAMS, type PrimitiveId } from './params/index'

/**
 * Every scene type the engine knows, derived from the params registry (core/params) so the two
 * never drift. Node code (CLI `validate`, renderer) and the runtime pass this list to
 * `parseStoryboard`. Ids starting with `_` are internal/test-only and never documented.
 */
export const PRIMITIVE_IDS = Object.keys(PARAMS) as PrimitiveId[]

export type { PrimitiveId }

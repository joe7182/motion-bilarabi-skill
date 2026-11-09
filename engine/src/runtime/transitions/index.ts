// Registers every runtime transition.
import { registerTransition } from './registry'
import { colorWipe } from './color-wipe'
import { whipPan } from './whip-pan'
import { zoomThrough } from './zoom-through'
import { glitchCut } from './glitch-cut'
import { morph } from './morph'
import { flood } from './flood'
import { iris } from './iris'
import { reveal } from './reveal'
import { bladeSlice, layerExplode, profileGrid } from './paper'
import { blinds, inkSlab, pageTurn, paperTear, penDotCurtain, pixelCurtain } from './print'

registerTransition(colorWipe)
registerTransition(whipPan)
registerTransition(zoomThrough)
registerTransition(glitchCut)
registerTransition(morph)
registerTransition(flood)
registerTransition(iris)
registerTransition(reveal)
registerTransition(pageTurn)
registerTransition(paperTear)
registerTransition(penDotCurtain)
registerTransition(pixelCurtain)
registerTransition(inkSlab)
registerTransition(blinds)
registerTransition(bladeSlice)
registerTransition(layerExplode)
registerTransition(profileGrid)

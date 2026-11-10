// Registers every runtime primitive. Later tasks add their primitives here.
import { registerPrimitive } from './registry'
import { appWindow } from './app-window'
import { backdrop } from './backdrop'
import { buildNumber } from './build-number'
import { chase } from './chase'
import { checklist } from './checklist'
import { commentCta } from './comment-cta'
import { counter } from './counter'
import { hero } from './hero'
import { highlight } from './highlight'
import { hud } from './hud'
import { icon } from './icon'
import { kineticText } from './kinetic-text'
import { lineArt } from './line-art'
import { morphObject } from './morph-object'
import { numberedSlots } from './numbered-slots'
import { particleWord } from './particle-word'
import { phone } from './phone'
import { profileCard } from './profile-card'
import { typeStretch } from './type-stretch'
import { lettersJoin } from './letters-join'
import { chapterBar } from './chapter-bar'
import { commentStickers } from './comment-stickers'
import { ecgLine, microscope } from './bio-fx'
import { bookFlip } from './book-flip'
import { captions } from './captions'
import { arabicMove } from './arabic-move'
import { effectList, liveCursor, voiceNote, commentDrop, headStack, predictKeys, dayDial, postWall, photoLook } from './creator-fx'
import { cutout, orbitRing } from './cutout'
import { editorialType } from './editorial'
import { glitchText, zoomCallout } from './glitch'
import { redPen, sketchWords } from './sketch'
import { gaugeRing, liveTimer, notifyStack, statBars } from './data-fx'
import { beatSlam, glowWords, laserBeam, laserType, techGrid } from './laser'
import { skillDeck, twinSync } from './skills-fx'
import { codeFile, permissionPrompt } from './devtools'
import { loadedDie, serverBatch, tokenOdds, tokenStream } from './odds'
import { codeChat, contextWindow, knowledgeTimeline, misquote, signatureCard, webCrawl } from './explainer'
import { heavyWord, saidWritten, viewfinder, wordCut } from './type-tricks'
import { logoRow } from './logo-row'
import { layerStack } from './layer-stack'
import { nodeGraph } from './node-graph'
import { chatThread } from './chat-thread'
import { probe } from './probe'
import { repeatLoop } from './repeat-loop'
import { screenClip } from './screen-clip'
import { searchTyping } from './search-typing'
import { sectionNumber } from './section-number'
import { shapeStates } from './shape-states'
import { slam } from './slam'
import { stamp } from './stamp'
import { video } from './video'
import { wipeReveal } from './wipe-reveal'
import { wordWall } from './word-wall'

registerPrimitive(appWindow)
registerPrimitive(backdrop)
registerPrimitive(buildNumber)
registerPrimitive(chase)
registerPrimitive(checklist)
registerPrimitive(commentCta)
registerPrimitive(counter)
registerPrimitive(hero)
registerPrimitive(highlight)
registerPrimitive(hud)
registerPrimitive(icon)
registerPrimitive(kineticText)
registerPrimitive(lineArt)
registerPrimitive(morphObject)
registerPrimitive(numberedSlots)
registerPrimitive(particleWord)
registerPrimitive(phone)
registerPrimitive(profileCard)
registerPrimitive(typeStretch)
registerPrimitive(lettersJoin)
registerPrimitive(chapterBar)
registerPrimitive(commentStickers)
registerPrimitive(ecgLine)
registerPrimitive(bookFlip)
registerPrimitive(captions)
registerPrimitive(arabicMove)
registerPrimitive(microscope)
registerPrimitive(heavyWord)
registerPrimitive(saidWritten)
registerPrimitive(wordCut)
registerPrimitive(viewfinder)
registerPrimitive(logoRow)
registerPrimitive(layerStack)
registerPrimitive(nodeGraph)
registerPrimitive(chatThread)
registerPrimitive(probe)
registerPrimitive(repeatLoop)
registerPrimitive(screenClip)
registerPrimitive(searchTyping)
registerPrimitive(sectionNumber)
registerPrimitive(shapeStates)
registerPrimitive(slam)
registerPrimitive(stamp)
registerPrimitive(video)
registerPrimitive(wipeReveal)
registerPrimitive(wordWall)
registerPrimitive(effectList)
registerPrimitive(liveCursor)
registerPrimitive(voiceNote)
registerPrimitive(commentDrop)
registerPrimitive(headStack)
registerPrimitive(predictKeys)
registerPrimitive(dayDial)
registerPrimitive(postWall)
registerPrimitive(photoLook)
registerPrimitive(cutout)
registerPrimitive(orbitRing)
registerPrimitive(knowledgeTimeline)
registerPrimitive(signatureCard)
registerPrimitive(webCrawl)
registerPrimitive(misquote)
registerPrimitive(tokenStream)
registerPrimitive(tokenOdds)
registerPrimitive(loadedDie)
registerPrimitive(serverBatch)
registerPrimitive(permissionPrompt)
registerPrimitive(codeFile)
registerPrimitive(skillDeck)
registerPrimitive(twinSync)
registerPrimitive(techGrid)
registerPrimitive(laserType)
registerPrimitive(editorialType)
registerPrimitive(glitchText)
registerPrimitive(zoomCallout)
registerPrimitive(sketchWords)
registerPrimitive(redPen)
registerPrimitive(notifyStack)
registerPrimitive(statBars)
registerPrimitive(gaugeRing)
registerPrimitive(liveTimer)
registerPrimitive(laserBeam)
registerPrimitive(glowWords)
registerPrimitive(beatSlam)
registerPrimitive(contextWindow)
registerPrimitive(codeChat)

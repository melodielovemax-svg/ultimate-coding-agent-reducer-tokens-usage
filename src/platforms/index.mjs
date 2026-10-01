import opencode from './opencode.mjs'
import gemini from './gemini.mjs'
import antigravity from './antigravity.mjs'
import copilot from './copilot.mjs'

export const PLATFORMS = [opencode, gemini, antigravity, copilot]

export const PLATFORM_IDS = PLATFORMS.map((p) => p.id)

export function getPlatform(id) {
  return PLATFORMS.find((p) => p.id === id) ?? null
}

export function detected() {
  return PLATFORMS.filter((p) => p.detect())
}
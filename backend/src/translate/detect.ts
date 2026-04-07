import { francAll } from 'franc-min'
import type { SupportedLanguage } from './provider'

const FRANC_ONLY = ['eng', 'fra', 'ell', 'cmn', 'zho']

function normalize(text: string): string {
  return text.trim()
}

export function isNonTranslatable(text: string): boolean {
  const t = normalize(text)
  if (t.length === 0) return true
  if (t.length < 3) return true
  if (/^\d+(\.\d+)?$/.test(t)) return true
  if (/^[\p{P}\p{S}\s]+$/u.test(t)) return true // punctuation/symbols/whitespace
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return true // email-ish
  if (/^https?:\/\/\S+$/i.test(t) || /^www\.\S+$/i.test(t)) return true // url-ish
  return false
}

function fromFranc(code3: string): SupportedLanguage | null {
  switch (code3) {
    case 'eng':
      return 'en'
    case 'fra':
      return 'fr'
    case 'ell':
      return 'gr'
    case 'cmn':
    case 'zho':
      return 'cn'
    default:
      return null
  }
}

export type DetectResult = {
  sourceLanguageCode: SupportedLanguage | null
  confidence: number
  reliable: boolean
}

/**
 * Detect language with a conservative confidence heuristic:
 * - `franc-min` returns normalized scores (higher is better).
 * - We treat confidence as the top score, and require a reasonable gap vs #2.
 */
export function detectSourceLanguage(text: string): DetectResult {
  const t = normalize(text)
  const ranked = francAll(t, { only: FRANC_ONLY, minLength: 10 })
  const top = ranked[0]
  if (!top || top[0] === 'und') return { sourceLanguageCode: null, confidence: 0, reliable: false }

  const topLang = fromFranc(top[0])
  const topScore = top[1] ?? 0
  const secondScore = ranked[1]?.[1] ?? 0
  const gap = topScore - secondScore

  if (!topLang) return { sourceLanguageCode: null, confidence: 0, reliable: false }
  if (topScore < 0.7 || gap < 0.2) return { sourceLanguageCode: null, confidence: topScore, reliable: false }

  return { sourceLanguageCode: topLang, confidence: topScore, reliable: true }
}


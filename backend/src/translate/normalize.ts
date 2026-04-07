/**
 * Normalization used for translation cache keys and hashing.
 * Keep this consistent across single + bulk paths.
 */
export function normalizeForTranslationKey(text: string) {
  return text.trim().toLowerCase()
}

/**
 * Normalization used for the actual provider payload.
 * We trim to avoid translating accidental whitespace, but we do not lowercase to preserve meaning.
 */
export function normalizeForProvider(text: string) {
  return text.trim()
}


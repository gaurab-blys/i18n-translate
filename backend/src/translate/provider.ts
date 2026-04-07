export type SupportedLanguage = 'en' | 'fr' | 'gr' | 'cn'

export interface TranslationProvider {
  translate(input: { text: string; targetLanguage: SupportedLanguage }): Promise<string>
  /** Batch translate; must preserve order and length of `texts`. */
  translateMany(texts: string[], targetLanguage: SupportedLanguage): Promise<string[]>
}

function toGoogleTarget(language: SupportedLanguage) {
  // Map our app codes to Google Translate language codes
  switch (language) {
    case 'en':
      return 'en'
    case 'gr':
      return 'el'
    case 'cn':
      return 'zh-CN'
    case 'fr':
    default:
      return 'fr'
  }
}

export class StubTranslationProvider implements TranslationProvider {
  async translate(input: { text: string; targetLanguage: SupportedLanguage }) {
    // Replace with a real translation API call (OpenAI, DeepL, etc.)
    return `[${input.targetLanguage}] ${input.text}`
  }

  async translateMany(texts: string[], targetLanguage: SupportedLanguage) {
    return texts.map((t) => `[${targetLanguage}] ${t}`)
  }
}

export class GoogleTranslationProvider implements TranslationProvider {
  private clientPromise: Promise<any> | null = null

  private async getClient() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        // This package is CommonJS; use require for compatibility.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Translate } = require('@google-cloud/translate').v2

        // Prefer standard GOOGLE_APPLICATION_CREDENTIALS (file path) or explicit JSON env.
        const credentialsJson = process.env.GOOGLE_TRANSLATE_CREDENTIALS_JSON
        const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_TRANSLATE_PROJECT_ID

        if (credentialsJson) {
          const credentials = JSON.parse(credentialsJson)
          return new Translate({ credentials, projectId: projectId || credentials.project_id })
        }

        // If no JSON is provided, the library will fall back to Application Default Credentials
        // (e.g. GOOGLE_APPLICATION_CREDENTIALS pointing to a mounted file, or workload identity).
        return new Translate({ projectId: projectId || undefined })
      })()
    }

    return this.clientPromise
  }

  async translate(input: { text: string; targetLanguage: SupportedLanguage }) {
    const client = await this.getClient()
    const target = toGoogleTarget(input.targetLanguage)
    const [translated] = await client.translate(input.text, target)
    return translated
  }

  async translateMany(texts: string[], targetLanguage: SupportedLanguage) {
    if (texts.length === 0) return []
    const client = await this.getClient()
    const target = toGoogleTarget(targetLanguage)
    const [translations] = await client.translate(texts, target)
    const out = Array.isArray(translations) ? translations : [translations]
    if (out.length !== texts.length) {
      throw new Error(`translateMany: expected ${texts.length} segments, got ${out.length}`)
    }
    return out
  }
}


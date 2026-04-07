/**
 * Standalone BullMQ worker for translation jobs. Use when API sets RUN_TRANSLATION_WORKER=false.
 * Needs the same env as the API: REDIS_URL, DATABASE_URL, TRANSLATION_*, Google creds, etc.
 * Usage: npx tsx src/worker-translation.ts  |  npm run worker:translation (after build)
 */
import './bin/worker.translation'

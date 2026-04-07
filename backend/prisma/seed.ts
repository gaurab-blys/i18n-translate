import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  const languages = [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'French' },
    { code: 'gr', name: 'Greek' },
  ] as const

  for (const lang of languages) {
    await prisma.language.upsert({
      where: { code: lang.code },
      update: { name: lang.name },
      create: { code: lang.code, name: lang.name },
    })
  }

  const langRows = await prisma.language.findMany()
  const langByCode = Object.fromEntries(langRows.map((l) => [l.code, l]))

  for (let i = 1; i <= 10; i++) {
    const userId = `user${i}`
    const preferred =
      i % 3 === 1 ? langByCode.en : i % 3 === 2 ? langByCode.fr : langByCode.gr

    await prisma.user.upsert({
      where: { userId },
      update: { languageId: preferred?.id ?? null },
      create: {
        userId,
        address: null,
        notes: null,
        languageId: preferred?.id ?? null,
      },
    })
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })


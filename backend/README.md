## Backend (Express + TypeScript + Prisma + Postgres + Redis)

### What’s included
- **Postgres**: stores `users` + `translations`
- **Redis**: optional hot cache for translations
- **Translation workflow** (hash + language):
  - check Redis
  - check DB unique `(hash, language_code)`
  - if miss: call provider (currently **stub**) → store → return

### Frontend + backend flow (what happens in the app)
- **Navbar**
  - Fetches **users** from `GET /users`
  - Fetches **languages** from `GET /languages`
  - Selecting a **user** triggers `GET /users/:userId` (React Query)
  - Changing **preferred language** calls `PUT /users/:userId/language`
- **Preferred language change is the “main deal”**
  - Backend updates the user’s `languageId`
  - Backend translates the user’s stored **`address`** and **`notes`** into the *new* preferred language
  - Backend **overwrites** `address` and `notes` with the translated strings and returns the updated user
  - Frontend updates i18n language and refreshes the user so the translated values replace what’s shown
- **Main page**
  - Reads selected `userId` (same `localStorage` key `user` used by Navbar)
  - Fetches current user with `GET /users/:userId`
  - Save button updates the user with `PUT /users/:userId` (address/notes)

### Run with Docker
From `backend/`:

```bash
docker compose up --build
```

Then apply migrations + seed (first time):

```bash
docker compose exec app npx prisma migrate dev --name init
docker compose exec app npx prisma db seed
```

API runs on `http://localhost:8080`.

### Run locally (no Docker)
From `backend/`:

```bash
npm install
npx prisma generate
npm run dev
```

Ensure `backend/.env` has `DATABASE_URL` + `REDIS_URL`.

### Translation provider (Google Translate)
This backend supports:
- **Stub provider** (default): returns `[lang] <text>`
- **Google Translate**: real translations via `@google-cloud/translate` (v2)

Enable Google provider:

```bash
TRANSLATION_PROVIDER=google
```

### Global cross-request translation batching (Redis Streams)
To reduce provider cost under load, cache-miss translations can be **batched across concurrent requests and across processes** using Redis Streams.

- **How it works**: cache misses enqueue into `itl:translation:req:<lang>` streams; a batcher process collects requests for ~10ms and calls `translateMany`.
- **Run the batcher worker (recommended)**:

```bash
npm run dev:batcher
```

Or after build:

```bash
npm run worker:translation:batcher
```

- **Optional (not recommended in prod)**: co-locate the batcher with the API by setting:

```bash
RUN_TRANSLATION_BATCHER=true
```

#### Environment knobs
- **`TRANSLATION_GLOBAL_BATCHING`**: set to `false` to disable (default enabled when Redis is present).
- **`TRANSLATION_GLOBAL_BATCH_WINDOW_MS`**: batching window (default `10`, max `50`).
- **`TRANSLATION_GLOBAL_BATCH_MAX`**: max requests per loop (default `200`).
- **`TRANSLATION_GLOBAL_BATCH_WAIT_TIMEOUT_MS`**: how long a caller waits for a batch result before falling back to a direct provider call (default `1500`ms).
- **`TRANSLATION_GLOBAL_BATCH_RESP_TTL_SEC`**: TTL for response keys (default `120`s).
- **`TRANSLATION_GLOBAL_BATCH_LOG`**: set to `true` to log batch sizes/dedupe.

#### Option B (ADC file path) — recommended for local Docker
1. Put your service account JSON at `backend/service-account.json` (or any path you prefer).
2. Set `GOOGLE_APPLICATION_CREDENTIALS` to the *in-container* path.

Docker Compose is already wired for this approach:
- mounts `./service-account.json` → `/app/service-account.json` (read-only)
- sets `GOOGLE_APPLICATION_CREDENTIALS=/app/service-account.json`

Important: do **not** commit real credentials.

### Endpoints
- `GET /health`
- `GET /languages`
- `GET /users`
- `GET /users/:userId`
- `PUT /users/:userId` body: `{ "address": "...", "notes": "..." }` (upserts/updates address + notes)
- `PUT /users/:userId/language` body: `{ "languageCode": "fr" }`
  - Side effect: **translates** the user’s current `address` + `notes` into the new language and **overwrites** them
- `POST /translate` body: `{ "text": "Hello", "target_language": "fr" }`

### Frontend integration notes (React)
Frontend lives in `../blys-itl-react`.

- **React Query provider**: `src/main.jsx`
- **API client**: `src/api/http.js` (uses `VITE_API_URL` or defaults to `http://localhost:8080`)
- **Hooks**
  - `useUsers`, `useUser`, `useUpdateUserLanguage`, `useUpsertUser` in `src/api/users.js`
  - `useLanguages` in `src/api/languages.js`

To point frontend to a different backend URL:

```bash
VITE_API_URL=http://localhost:8080
```


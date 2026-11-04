# חידוני מתניה

Live quiz app (Kahoot-style). The host signs in, builds quizzes and runs a live game on a big screen; players join from their phones by scanning a QR code or typing the 6-digit code — no account needed.

- Frontend: plain JS bundled with esbuild → static site (`dist/`)
- Backend: Supabase (Postgres + Realtime + Auth + Storage). All schema/RLS/RPCs are in `supabase/schema.sql`.

## Deploy on Vercel
1. Import this repo in Vercel (framework preset: **Other**). `vercel.json` already sets build command and output directory.
2. Optional environment variables (the project's public URL/publishable key are the defaults in `src/config.js`):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. In Supabase → Authentication → URL Configuration, set **Site URL** to your Vercel URL (needed for e-mail links such as password reset).
4. In Supabase → Authentication → Sign In / Providers → Email, turn **off** "Confirm email" if you want hosts to sign up without confirming by e-mail.

## Database
Run `supabase/schema.sql` once in the Supabase SQL editor (safe to re-run).

## Local
```
npm ci && npm run build && npm run serve   # http://localhost:5173
```

## End-to-end test (1 host + N phones, real Supabase)
```
npm i --no-save playwright && npx playwright install chromium
BASE_URL=http://localhost:5173 PLAYERS=20 HOST_EMAIL=... HOST_PASSWORD=... node tests/live-game.cjs
```
It covers joining by code and by QR link, answering, scoring, kick/rename, a phone reloading, a phone going offline, the host reloading mid-question, play again, and game end.

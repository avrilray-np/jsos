# JSOS — Japanese Speaking OS

JSOS is a responsive Japanese speaking practice system. ChatGPT Project Voice runs the live conversation; JSOS manages the adaptive plan, task prompts, summary import, review, vocabulary, sentences, Anki exports and learning progress.

## Prerequisites

- Node.js 24 LTS
- npm

## Local development

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. The current interface uses realistic demo data until Supabase is connected.

## Validation

```bash
npm run lint
npm run build
npm test
```

## Supabase setup

1. Create a private Supabase project.
2. Disable public sign-up and create the single allowed account.
3. Copy `.env.example` to `.env.local` and fill the Supabase values locally.
4. Apply `supabase/migrations/0001_jsos_initial.sql`.
5. Apply `supabase/seed.sql` to create the 40 core curriculum templates.

Do not commit `.env.local`, API keys, passwords, refresh tokens, or service-role keys.

## ChatGPT Project setup

Copy the contents of `docs/chatgpt-project-instructions.md` into the ChatGPT Project instructions. Add these project sources:

- `docs/scoring-rubric.md`
- `docs/summary-json-spec.md`

## Product invariants

- The system timezone is always `Asia/Shanghai`.
- Missing a date creates a grey “已顺延” calendar entry and does not consume a Day.
- Completed Day numbers never change.
- Reinforcement tasks shift only unfinished future Day numbers.
- Valid pasted JSON imports without an AI call.
- Scheduled jobs must be idempotent and keep the last valid task version on failure.

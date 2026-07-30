# JSOS v1 Architecture

JSOS is a responsive web/PWA for one allow-listed user. ChatGPT Project Voice performs live practice; JSOS owns curriculum, scheduling, review, import, vocabulary and progress.

## Runtime boundaries

- The browser renders the calendar, tasks and learning library.
- Supabase Auth provides email/password sign-in with public registration disabled.
- PostgreSQL is the source of truth. Browser storage is never authoritative.
- The daily scheduler uses `Asia/Shanghai`, an idempotency key per date and a transaction/lock.
- OpenAI calls stay server-side behind `generateTask`, `repairSummary` and `generateReview` adapters.
- Valid pasted JSON is imported without an AI call. Invalid JSON can be repaired only after preserving the original text.

## Scheduling invariants

- Completed Day numbers are immutable.
- Missing a calendar date creates a grey `deferred` entry and does not consume a Day.
- A task keeps its stable UUID when moved.
- Reinforcement inserts into the future sequence; only unfinished Day numbers change.
- Generation writes a new version before replacing the active version.
- Every cron transition can run repeatedly without duplicating tasks.

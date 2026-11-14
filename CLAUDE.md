The rules for this repository are in AGENTS.md. Read it in full before changing anything.

## NEVER

These are irreversible or unrecoverable. No exceptions without the owner's explicit say-so in the session.

1. **Never rename, reuse or delete an exercise id.** Ids key every `workout_log` row. *(`ids.lock.json` + `node tests/check.js`)*
2. **Never commit to `main`.** Branch and open a PR — merging publishes. *(branch protection)*
3. **Never write to `gp_*` tables** — they belong to the goals-prayers app. Reads only. *(`node tests/check.js`)*
4. **Never run SQL against the live database.** Write it to `sql/` with a rollback; the owner runs it. *(rule 6)*
5. **Never add a service worker.** *(`node tests/check.js`)*
6. **Never drop or rename a column.**
7. **Never put a secret in the repo** — it is public. The Supabase publishable key in `index.html` is public by design.
8. **Never change the rules or the checks in the same PR as code.** Rules = `AGENTS.md`, `CLAUDE.md`, `opencode.json`,
   `tests/check.js`, `tests/check.selftest.js`, `.github/workflows/guard.yml`. Code = `index.html`,
   `manifest.webmanifest`, icons, `vendor/`, `sql/`. Rules change in a PR of their own. *(`node tests/check.js`, in CI)*
   `CLAUDE.md` carries a pointer plus a byte-identical copy of this NEVER block for tools that still read it;
   the check fails if the two copies drift.

`node tests/check.js` runs on GitHub for every PR to `main` (workflow `guard`); make it pass locally first.

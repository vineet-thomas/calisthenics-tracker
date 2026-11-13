# Tests

Run before every PR (CLAUDE.md rules 4 and 5). Everything runs locally in your installed Google Chrome;
nothing touches the live Supabase project.

```bash
cd tests && npm install          # once
node tests/check.js              # pre-commit check: script syntax, manifest, exercise-id lock
node tests/run.js                # check + its self-test + sync + programme (incl. regression vs main)
node tests/run.js --realstack    # also real Postgres + PostgREST (needs: brew install postgresql@16)
```

| Suite | What it covers |
|---|---|
| `check.js` | Inline scripts parse, manifest is valid JSON, every id in `ids.lock.json` is still in `EX_REGISTRY`, new ids are in the lock, every work-list exercise is registered. |
| `check.selftest.js` | Proves the check catches renames, deletions, unlisted new ids, unregistered exercises, syntax errors and a bad manifest — and allows retiring a movement. |
| `sync.test.js` | On-device queue with a fake backend: offline entries, refresh survival, in-flight refresh, refused entries (red badge, retry, discard), server back-off and setting aside, conflicts, Clear day, clock safety, typing merged, storage notice, "Couldn't sync" message. |
| `programme.test.js` | Display rules for whatever programme `index.html` holds (work lists, run and rest days, colours, 390 px), Progress history, logging every exercise. **Regression:** every day and the Progress view must match `main`'s display code exactly (HTML, styles, pixels). If a PR changes the display on purpose, run with `ALLOW_RENDER_CHANGE=1` and explain the differences in the PR. |
| `realstack/sql.test.sh` | The SQL in `sql/` on a local Postgres with Supabase-like roles and RLS: behaviour, idempotency, and every rollback (apply, roll back, re-apply). |
| `realstack/e2e.test.js` | The real app and real supabase-js against local PostgREST: saves through RLS, a losing offline edit ends Synced (HTTP 200), Clear day, a real permission refusal and retry, deload. |

Test-only values: user `11111111-1111-1111-1111-111111111111`, `test@example.com`, and a local JWT secret
that only signs tokens for the throwaway local database. Scratch files go to `tests/.tmp/` (git-ignored).

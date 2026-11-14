# AGENTS.md — calisthenics-tracker

Instructions for any coding agent working in this repository (loaded via `opencode.json`). Read fully
before changing anything.

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

## What this is

Personal training and health tracker PWA. Owner: Vineet Thomas.
Production: https://vineet-thomas.github.io/calisthenics-tracker/ (GitHub Pages, deploys from `main`).
Shares a Supabase project and login with the `goals-prayers` app.

**There is no preview environment.** GitHub Pages publishes `main` directly, so merging is
publishing. Everything must be verified at `localhost` before the PR is merged.

## Architecture (keep it this way unless asked)

- `index.html` — the whole app: markup, CSS and one inline `<script>`. No build step, no framework.
  ~1,750 lines. The training programme lives in constants between roughly lines 310 and 430.
- `manifest.webmanifest` + icons — PWA install assets.
- **No service worker.** Do not add one without asking: it would cache the app shell and make
  every future release invisible until the cache expires, on a site that has no preview to catch it.
- Supabase for auth, data and storage. Offline-first: writes queue locally and flush on reconnect.

### Tables this app owns

`day_status`, `workout_log`, `measurements`, `sleep`, `activity`, `nutrition`, `body_comp`,
`screenshots`, `settings`, `error_log`.

Tables prefixed `gp_*` belong to the **goals-prayers** app. Read them if needed; never alter
their schema, and never write to them from here.

## Rules

1. **Exercise ids are permanent.** `EX_REGISTRY[].id` and the `id` fields in `PUSH`, `PULL`,
   `LEGS` are the primary key of every row in `workout_log`. **Never rename, never reuse, never
   delete an id.** Renaming one silently orphans years of chart history. Changing an exercise's
   display name, target or cue is fine — changing its id is not. Retiring a movement means
   removing it from the day's `work` array while leaving it in `EX_REGISTRY` so its history
   still draws. Every id is listed in `ids.lock.json`; the check (rule 4) fails if a locked id
   disappears from `EX_REGISTRY`. A new id is added to the lock deliberately, in the same PR.
2. **Branch, never commit to main.** Name branches `feature/<short-name>` or `fix/<short-name>`.
3. **Every release bumps `APP_VERSION`** (semver) in index.html.
4. **Run the check before committing:**
   ```bash
   node tests/check.js     # syntax, manifest, id lock, no service worker, no gp_* writes, rules/code not mixed,
                           # APP_VERSION bumped, no secrets, no DROP/RENAME COLUMN, NEVER copies identical
   ```
5. **Run the tests before every PR** (`cd tests && npm install` once; see `tests/README.md`):
   ```bash
   node tests/run.js               # every PR
   node tests/run.js --realstack   # also whenever sync code or anything in sql/ changes
   ```
   All suites must pass. The regression compares every day and the Progress view with `main`;
   if a PR changes the display on purpose, run with `ALLOW_RENDER_CHANGE=1` and list the
   differences in the PR. New behaviour gets a new test in the same PR. Paste the summary into
   the PR. Then check the changed day by eye at 390 px (`python3 -m http.server 8000`) —
   because there is no preview, this is the only gate before production.
6. **Schema changes:** add them as idempotent SQL (`if not exists`, RLS included) AND tell the
   owner the exact SQL to run in Supabase before merging. Never drop or rename columns.
   **Any SQL that touches the live database ships with its reverse:** `sql/NNN-<name>.sql`
   plus `sql/NNN-<name>-rollback.sql` in the same PR. Both must be idempotent, and both must be
   tested (apply, roll back, re-apply) before the PR is opened — `tests/realstack/sql.test.sh`
   does this for every script in `sql/`; add behaviour checks for the new script there.
7. **No backup files** (`index-bkp*.html`, `index copy.html`). Git history is the backup.
8. **Day objects must keep their shape.** Every entry in `DAYS` points at a data object with
   either a `work` + `stretch` pair (training days) or a `circuit` + `stretch` pair (run and
   rest days). A `circuit` may hold a single item — confirm it still renders when you change one.
9. **Colour groups:** push `#4f8ff0` (blue), pull `#5ec27e` (green), legs `#e0894a` (amber).
   Keep new exercises in the right group so the Progress charts stay readable.
10. **Content is personal.** Keep exercise cues, targets and programme structure exactly as
    given unless the owner asks to change them. The programme is designed around specific
    goals, a Thursday water fast and a Garmin running plan — do not "optimise" it.
11. **Never put secrets in the repo.** The Supabase publishable key in index.html is public by
    design; data is protected by RLS.

## Release flow

```bash
git checkout main && git pull
git checkout -b feature/<name>
# make the change, bump APP_VERSION
node tests/check.js && node tests/run.js           # add --realstack for sync or SQL changes
python3 -m http.server 8000                        # verify at localhost, 390 px
git add <the files you changed>                    # never `git add -A`: the folder holds the owner's working files
git commit -m "<type>: <summary>"                  # types: feat, fix, content, style, chore
git push -u origin feature/<name>
gh pr create --fill
```

Report back: the PR link, the test summary, any SQL the owner must run, and confirmation that
the app loaded clean at localhost. The owner merges, which publishes immediately. When PRs are
stacked, don't delete a branch on merge while another open PR is based on it — GitHub closes
that PR.

## Handoff from claude.ai chats

The owner designs changes with Claude in a claude.ai Project, then brings them here as either:

- **A change brief** (text, or a file in `docs/` — e.g. `docs/calisthenics-coach-BRIEF.md`) — implement
  it following the rules above; ask if anything is ambiguous. A brief's status table says what has shipped.
- **An updated file** placed in the repo folder — review the diff, keep any repo changes the
  file would overwrite, then run the release flow.

**Check the brief against the repo before applying it.** Briefs are written from a snapshot and
the repo may have moved on. If a brief supersedes an earlier one, confirm which version the
file is actually at before starting — applying a stale brief has silently reverted live fixes
on the sibling app before.

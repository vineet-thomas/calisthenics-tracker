# CLAUDE.md — calisthenics-tracker

Instructions for Claude Code working in this repository. Read fully before changing anything.

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
   still draws.
2. **Branch, never commit to main.** Name branches `feature/<short-name>` or `fix/<short-name>`.
3. **Every release bumps `APP_VERSION`** (semver) in index.html.
4. **Run the check before committing:**
   ```bash
   node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach(m=>new Function(m[1]));JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));console.log('OK')"
   ```
5. **Test locally** with `python3 -m http.server 8000`. Check the changed day at 390 px width
   for overflow, and confirm the console is clean. Because there is no preview, this is the
   only gate before production.
6. **Schema changes:** add them as idempotent SQL (`if not exists`, RLS included) AND tell the
   owner the exact SQL to run in Supabase before merging. Never drop or rename columns.
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
# make the change, bump APP_VERSION, run the check
python3 -m http.server 8000          # verify at localhost, 390 px
git add -A && git commit -m "<type>: <summary>"   # types: feat, fix, content, style, chore
git push -u origin feature/<name>
gh pr create --fill
```

Report back: the PR link, any SQL the owner must run, and confirmation that the app loaded
clean at localhost. The owner merges, which publishes immediately.

## Handoff from claude.ai chats

The owner designs changes with Claude in a claude.ai Project, then brings them here as either:

- **A change brief** (text or `CHANGE-BRIEF.md`) — implement it following the rules above; ask
  if anything is ambiguous.
- **An updated file** placed in the repo folder — review the diff, keep any repo changes the
  file would overwrite, then run the release flow.

**Check the brief against the repo before applying it.** Briefs are written from a snapshot and
the repo may have moved on. If a brief supersedes an earlier one, confirm which version the
file is actually at before starting — applying a stale brief has silently reverted live fixes
on the sibling app before.

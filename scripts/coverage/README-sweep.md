# Tournament Sweeper — Operations

## What it does

Weekly URL-liveness + lifecycle maintenance over every row in
`config/states/*/tournaments.json`. The sweeper NEVER creates or deletes
rows. Research remains the source of truth for card creation.

Behavior per row:
- HEAD (GET fallback) each `website` + `registrationUrl`.
- Record `lastChecked`, `lastHttpStatus`, `consecutiveFailures`.
- Flag `lifecycle='stale'` after 2+ consecutive failures.
- Flag `lifecycle='moved'` when a 2xx/3xx final URL lands on a different host (records `movedTo`).
- Recover automatically on success if previously flagged `stale` or `moved` (lifecycle re-derives from dates).
- Never demotes `missing-from-research` — only re-ingest clears that.

Output: JSON report at `scripts/coverage/_reports/sweep-YYYY-MM-DD.json`
(gitignored).

## Running it

```bash
# One state:
node scripts/coverage/sweep-tournaments.js --state CA

# All states:
node scripts/coverage/sweep-tournaments.js --all

# Dry-run (no writes, still makes HTTP requests):
node scripts/coverage/sweep-tournaments.js --all --dry-run

# Tuning:
node scripts/coverage/sweep-tournaments.js --all --concurrency 8 --timeout 10000
```

## Weekly cron — Cloud Scheduler

Target: every Monday 06:00 America/Los_Angeles. Runs against the Cloud
Function wrapper once we expose the sweeper as an HTTP endpoint. Until
then, run locally via launchd or wrap in a GCE cron on the `tu-sandbox`.

### Option A — macOS launchd (local run, no cloud)

```bash
cat > ~/Library/LaunchAgents/com.teamsunited.tournament-sweep.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.teamsunited.tournament-sweep</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>/Users/prcummins/.paperclip/instances/default/workspaces/2ffee6d1-2842-4607-b21e-a0eca2a8b916/scripts/coverage/sweep-tournaments.js</string>
    <string>--all</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>1</integer>
    <key>Hour</key><integer>6</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/prcummins/Desktop/Obsidian/Machine/Outputs/data/sweep-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/prcummins/Desktop/Obsidian/Machine/Outputs/data/sweep-stderr.log</string>
</dict>
</plist>
PLIST
launchctl load ~/Library/LaunchAgents/com.teamsunited.tournament-sweep.plist
```

### Option B — GCE cron on tu-sandbox

Once tu-sandbox is running:

```bash
# On tu-sandbox:
crontab -l | { cat; echo "0 13 * * 1 cd /home/prcummins/teams-united-league-service && node scripts/coverage/sweep-tournaments.js --all >> /var/log/tu-sweep.log 2>&1"; } | crontab -
```

(13 UTC Mon = 06:00 PT during PDT.)

## Flag-queue review

After each run:
1. Look at the report JSON for rows with `lifecycle in (stale, moved)`.
2. For `moved`: check `movedTo`. If the new host is legit, update `website` and re-run — sweeper will clear the flag.
3. For `stale`: if the event is truly dead, mark `lifecycle: 'completed'` manually. If transient (site migration, holiday outage), leave it — next week's run clears it on recovery.

Tournament Discovery Agent owns this review loop.

# Nightly sync

`nightly-sync.cmd` runs the whole refresh in order — Ticketmaster ingest,
Relentless Beats scrape, then Spotify/Deezer enrichment — and appends to
`logs/nightly-sync.log`.

Enrichment runs **last** on purpose. Both ingest scripts create artists with
nothing but a name; `sync:spotify` is what resolves their streaming ids. Run it
first and every artist added tonight waits a full day for links. That ordering
mistake is why Denver, LA, and Las Vegas sat at ~20% Spotify coverage while
Phoenix was at 99%.

## Scheduled task

Registered with Windows Task Scheduler, daily at 04:00:

```powershell
Get-ScheduledTask     -TaskName "DSCOVR Nightly Sync"
Get-ScheduledTaskInfo -TaskName "DSCOVR Nightly Sync"   # LastRunTime / LastTaskResult / NextRunTime
Start-ScheduledTask   -TaskName "DSCOVR Nightly Sync"   # run it now
Unregister-ScheduledTask -TaskName "DSCOVR Nightly Sync" -Confirm:$false
```

`-StartWhenAvailable` is set, so a run missed because the machine was asleep
fires once it wakes rather than being skipped.

The execution time limit is **6 hours** (`PT6H`). It was 2 when ingestion covered
4 markets and took ~6 minutes; migration 0013 took that to 26, so the Ticketmaster
pass alone scales roughly 6x before the scrape and enrichment run. If the task
exceeds its limit Windows kills it mid-pass, leaving some markets ingested and
others stale with only a truncated log — hence the headroom. To change it:

```powershell
$t = Get-ScheduledTask -TaskName "DSCOVR Nightly Sync"
$t.Settings.ExecutionTimeLimit = "PT6H"   # ISO-8601 duration, not "06:00:00"
Set-ScheduledTask -TaskName "DSCOVR Nightly Sync" -Settings $t.Settings
```

## Why a local scheduled task and not something better

- **GitHub Actions** would be the natural home, but this repo has no remote —
  nothing to run a workflow on. If you push it to GitHub, move this there: the
  runner is always up, and the machine being asleep stops mattering.
- **A cloud agent / Supabase pg_cron** can't reach the credentials. The API
  keys live in a gitignored local `.env`, and the ingest scripts are Node
  processes against Ticketmaster/Spotify, not SQL.

So this is the option that works today, with the tradeoff that **the sync only
runs when this machine is on**. Nothing recovers a run missed while it is
powered off — `-StartWhenAvailable` only covers sleep/hibernate.

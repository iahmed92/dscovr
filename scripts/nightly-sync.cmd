@echo off
REM Nightly DSCOVR refresh: ingest first, then enrich.
REM
REM Order matters. Both ingest scripts upsert artists with nothing but a name,
REM and sync:spotify is what resolves their streaming ids — running it last
REM means artists added tonight get enriched tonight, instead of sitting
REM link-less until the next run. Getting this backwards is what left Denver,
REM LA and Las Vegas at ~20%% Spotify coverage.
REM
REM Scheduled via schtasks (see scripts/README-scheduled-sync.md).
REM Remove with:  schtasks /delete /tn "DSCOVR Nightly Sync" /f

cd /d "%~dp0.."

set LOGDIR=%~dp0..\logs
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
set LOG=%LOGDIR%\nightly-sync.log

echo. >> "%LOG%"
echo ================================================== >> "%LOG%"
echo Run started %DATE% %TIME% >> "%LOG%"

call npm run sync:ticketmaster >> "%LOG%" 2>&1
echo -- ticketmaster exit %ERRORLEVEL% >> "%LOG%"

call npm run scrape:relentlessbeats >> "%LOG%" 2>&1
echo -- relentless beats exit %ERRORLEVEL% >> "%LOG%"

call npm run sync:spotify >> "%LOG%" 2>&1
echo -- spotify enrichment exit %ERRORLEVEL% >> "%LOG%"

echo Run finished %DATE% %TIME% >> "%LOG%"

# Decisions

Format: `## YYYY-MM-DD — title` · What · Why · Alternative considered.

## 2026-10-29 — Rebuild as Tizen web app, AVPlay player
What: Vanilla JS web app (.wgt) for Tizen 5.5 using Samsung AVPlay. Why: Kotlin/ExoPlayer can't run on Tizen; AVPlay is the only player with hardware 4K/HDR on Samsung. Alternative: HTML5 `<video>` + MSE (no MKV, weaker codec coverage).

## 2026-10-29 — DTS/TrueHD avoided, not decoded
What: Streams whose audio is only DTS/TrueHD are excluded from auto-play; multi-audio files get a playable track selected. Why: TU8000 has no DTS/TrueHD decoder or passthrough; software decoding on the TV is unproven. Alternative: TorBox transcoder / home server via the `resolvePlayableUrl` hook (future).

## 2026-10-29 — Dropped: self-update, Watch Next, frame-rate match, passthrough
Why: no Tizen equivalent for a sideloaded app on 2020 firmware. Updates go through Apps2Samsung.

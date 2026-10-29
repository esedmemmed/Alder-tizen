# Decisions

Format: `## YYYY-MM-DD — title` · What · Why · Alternative considered.

## 2026-10-29 — Rebuild as Tizen web app, AVPlay player
What: Vanilla JS web app (.wgt) for Tizen 5.5 using Samsung AVPlay. Why: Kotlin/ExoPlayer can't run on Tizen; AVPlay is the only player with hardware 4K/HDR on Samsung. Alternative: HTML5 `<video>` + MSE (no MKV, weaker codec coverage).

## 2026-10-29 — DTS/TrueHD avoided, not decoded
What: Streams whose audio is only DTS/TrueHD are excluded from auto-play; multi-audio files get a playable track selected. Why: TU8000 has no DTS/TrueHD decoder or passthrough; software decoding on the TV is unproven. Alternative: TorBox transcoder / home server via the `resolvePlayableUrl` hook (future).

## 2026-10-29 — Dropped: self-update, Watch Next, frame-rate match, passthrough
Why: no Tizen equivalent for a sideloaded app on 2020 firmware. Updates go through Apps2Samsung.

## 2026-10-29 — Phase 2 decisions (accepted in review)
- **Audio key in rank()**: after `awkward`/"may not play" and `fit()`, before Settings' preference; good 3, mixed 2, unknown 1, bad 0. Bad-audio sources never auto-play; listed last with "No sound on this TV". BEST MATCH = first wanted source with sound.
- **"May not play" key**: streams needing request headers other than User-Agent/Cookie rank right after Alder's `awkward` key.
- **Stable sort everywhere** (`util.stableSort`): Chromium 69's Array.sort is not stable; Alder's ranking relies on ties keeping add-on order.
- **Watched bitfield bound**: dropped Alder's extra `bit < ids.size` check; stremio-core's resize bounds by the old bitfield's length only, so Alder could drop the anchor when earlier episodes disappear. Output: zlib level 6, padded base64.
- **bestAudio**: Alder's order (no commentary → language → default flag → channels) with "known playable" as the first key; a commentary-only playable track beats silence; unknown codec strings count as "maybe" and only beat nothing.
- **Subtitle.isLocal** also accepts ISO 639-2/B codes (ger, fre) that OpenSubtitles sends.
- **Kept as Alder**: overallTimeWatched double-count after a video switch (stremio-core parity question, not a Tizen issue).

# Alder for Tizen

Alder for Tizen is [Alder](https://github.com/aradhyas8/Alder) rebuilt as an app for **Samsung TVs** (Tizen 5.5, tested on
the 2020 TU8000). Alder is a TV interface for your Stremio account: you press Play and it picks a source that works on your
TV, moves on by itself when one fails, and keeps your watch progress in sync with Stremio on your phone. It uses your own
Stremio account and your own add-ons; it brings no content of its own.

You can install it with **only an Android phone and the TV remote**. No computer is needed.

## Credit

Alder is by [aradhyas8](https://github.com/aradhyas8/Alder) and is released under the GNU GPL v3. This is a port: the
behaviour, the rules for choosing a source, the wording and the look come from Alder's source code. Alder for Tizen is
released under the same licence. If you like it, go and give the original a star.

## What is different on a Samsung TV

| Alder on Android TV | Alder for Tizen |
|---|---|
| Plays DTS and TrueHD sound by decoding it in software | **Avoids DTS and TrueHD.** |
| Updates itself from GitHub | You install a newer `Alder.wgt` the same way as the first one. |
| Watch Next row, frame-rate matching, audio pass-through | Not available on a sideloaded Samsung app. |
| logcat for problems | A **Diagnostics** screen you can photograph with your phone. |

**Why DTS and TrueHD are avoided.** The picture and sound on a Samsung TV come from the TV's own hardware player. A TU8000 has
no DTS or TrueHD decoder and cannot pass them to a receiver either, so a film whose only sound is DTS or TrueHD would play in
silence. Alder works out each release's sound from its name before it plays, leaves those releases out of Play (they are
listed last, marked "No sound on this TV"), and for files that carry several sound tracks it picks one the TV can play (for
example Dolby Digital next to DTS). Diagnostics shows which track it chose and why.

## Install on your TV (summary)

You need the Android phone, the TV remote, and the phone and TV on the same Wi-Fi. The full step by step guide, with what
to do when something goes wrong, is in **[docs/SETUP.md](docs/SETUP.md)**. In short:

1. Install the **Apps2Samsung** app on your phone.
2. On the TV, turn on Developer Mode and give it your phone's IP address.
3. In Apps2Samsung choose **Your own package**, pick `Alder.wgt`, and wait for it to finish.

When something does not work on the TV, **[docs/TV-TEST.md](docs/TV-TEST.md)** lists what to try and what to photograph.

## Build it yourself

You need Node.js 22 or newer.

```
npm ci
npm run build
```

This makes `dist/Alder.wgt`, the file you install on the TV (about 450 KB). It is unsigned on purpose: Apps2Samsung signs it
with your own certificate when it installs.

Other commands: `npm test` (unit tests), `npm run compat` (checks the code only uses what a 2020 Samsung TV's browser
has), `npm run shots` (drives the app in a desktop browser with a fake Stremio account and saves screenshots to `shots/`),
`npm run dev` (serves that fake setup at http://127.0.0.1:8080). `dev/README.md` explains the test setup.

## Licence

GNU General Public License v3.0 or later: see [LICENSE](LICENSE). The bundled fonts (Inter, Instrument Serif) are under the
SIL Open Font License; `pako` and `qrcode-generator` are under permissive licences. Their texts are inside the `.wgt`
(`licenses/`).

---
name: Vail Adapter MIDI Integration Plan
description: Agreed approach for adding Vail adapter (MIDI) input to morsewalker, borrowing from vail-master
type: project
---

## Goal
Add Vail adapter (USB MIDI) input to morsewalker so users can use a straight key or paddle instead of typing. Decoded Morse characters go into the active response field (responseField, infoField, or infoField2).

## Agreed approach
Borrow the relevant, already-complete files from `/home/felw/env/mw_redoing/vail-master/scripts/` — no rewriting needed.

## Files copied from vail-master into src/js/
`time.mjs`, `audio.mjs`, `morse-pro.mjs`, `morse-pro-wpm.mjs`, `morse-pro-decoder.mjs`,
`morse-pro-decoder-adaptive.mjs`, `decoder.mjs`, `keyers.mjs`, `outputs.mjs`, `inputs.mjs`

## New integration layer
`vail-input.js` — MorseWalkerTransmitter + KeyerWrapper + public API (enable/disable/changeKeyerMode)

## Files modified
- `src/index.html` — new "Vail Adapter (MIDI Input)" accordion item with: enable toggle, keyer mode dropdown, MIDI status badge, keying speed input, DIT/DAH/TX indicators, decoded test output field, clear button
- `src/js/app.js` — import from vail-input.js + localStorage restore/save + event wiring
- `README.md` — Vail Adapter section + Credits section (Vail-CW, Stephen C. Phillips)

## Speed settings (split — fully independent)
| Field | ID | Default | Controls |
|---|---|---|---|
| Playback Speed (WPM) | `yourSpeed` | 16 | How fast YOUR station's audio plays (CQ, exchange, TU) |
| Keying Speed (WPM)   | `vailSpeed` | 14 | Vail keyer dit duration + MIDI adapter + decoder WPM |

## Key architecture: two operating modes
Matches exactly how vail-master works (discovered by reading main.mjs):

- **Pass-through (mode 1 — straight/cootie):** Adapter sends raw Note 1/2 paddle events. Browser StraightKeyer handles timing. KeyerWrapper.Straight() → Key(0, ...) → keyer → TX.
- **Adapter-keyed (mode > 1 — bug, iambic, etc.):** Adapter runs keyer internally, sends Note 0 for each element. KeyerWrapper.Straight() routes directly to transmitter.BeginTx()/EndTx() — bypasses browser keyer. DIT/DAH indicators don't separately light in this mode; only TX indicator.

The `Numbers` dict in keyers.mjs maps mode names to adapter mode numbers (e.g. iambicb → 8).

## Bug fixed: iambic "dits on both sides"
**Root cause:** We were hardcoding `SetKeyerMode(1)`. In practice, mode 1 on the Vail adapter collapses both paddle sides into Note 0 (Straight() calls), so the dah paddle also gave dits. Modes > 1 make the adapter run the keyer and send Note 0 for all elements.
**Fix:** `enable()` now calls `midiInput.SetKeyerMode(Numbers[keyerModeName])`. KeyerWrapper.Straight() routes directly to TX when adapterIsKeying=true.

## Implementation status: Phase 1 COMPLETE (awaiting retest after iambic bug fix)

### Next steps
1. User retests with `docker compose up` → `http://localhost:8080` — iambic B should now work
2. Phase 2 — Option B (key CQ to trigger CQ button, auto-submit on word gap, key TU)
3. Error correction idea from user (their own idea, deferred)

**Why:** User wants to practice CW contesting with a real key/paddle, not just typing. This matches how real CW operation works.
**How to apply:** All files are in place. On resuming, first check test results, then fix issues, then proceed to Phase 2.

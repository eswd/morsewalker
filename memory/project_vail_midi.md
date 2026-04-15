---
name: Vail Adapter MIDI Integration Plan
description: Agreed approach for adding Vail adapter (MIDI) keyer input to morsewalker, borrowing from vail-master
type: project
---

## Goal
Add Vail adapter (USB MIDI) input to morsewalker so users can use a straight key or paddle instead of typing. Decoded Morse characters go into the active response field (responseField, infoField, or infoField2).

## Agreed approach
Borrow the relevant, already-complete files from `/home/felw/env/mw_redoing/vail-master/scripts/` — no rewriting needed.

## Files to copy from vail-master into morsewalker src/js/
- `inputs.mjs`   — MIDI input handling, adapter configuration
- `keyers.mjs`   — all keyer modes (straight, iambic A/B, bug, ultimatic, etc.)
- `outputs.mjs`  — sidetone oscillator (Buzz/Silence with smooth ramps)
- `decoder.mjs`  — Morse timing → character decoder (wrapper)
- `morse-pro-decoder.mjs`          — core decoder logic
- `morse-pro-decoder-adaptive.mjs` — adaptive WPM speed tracking
- `morse-pro-wpm.mjs`              — PARIS timing calculations
- `morse-pro.mjs`                  — Morse dictionary (text ↔ morse maps)
- `time.mjs`                       — time constants

## Files NOT needed from vail-master
- `practice.mjs`, `scoring.mjs`, `storage.mjs`, `main.mjs`, `exchange.mjs`
  (morsewalker already handles all of that)

## What still needs to be written (thin integration layer)
1. A new `src/js/vail-input.js` (or similar) that:
   - Instantiates the keyer + MIDI input + sidetone + decoder
   - Reads morsewalker's WPM setting (`yourSpeed`) and feeds it to the keyer
   - Routes decoded text output → whichever response field is currently focused
2. Wiring in `app.js` — import + initialize on DOMContentLoaded
3. A small UI section in `index.html`:
   - Enable/disable toggle for Vail adapter
   - Keyer mode selector (at minimum: Straight, Iambic B; ideally all modes)
   - MIDI connection status indicator

## How the Vail MIDI adapter works
- USB MIDI device; communicates via MIDI Note On/Off
- Note 0 = straight key, Note 1 = dit paddle, Note 2 = dah paddle
- Two operating modes:
  - **Adapter pass-through (mode ≤ 1):** browser runs the keyer logic
  - **Adapter-keyed (mode > 1):** adapter runs iambic/bug itself; browser treats all input as straight key
- Browser configures the adapter by sending: CC#0 = disable keyboard mode, CC#1 = dit duration / 2, Program Change = keyer mode

## Decided: Interaction model (Option A)
Keying on the paddle/key decodes to text and appends it to the currently focused response field. User still clicks Send / TU / CQ as before. This is Phase 1.

Option B (full CW control — key CQ, auto-submit on word gap, key TU) is deferred to Phase 2.

## Decided: Keyer modes
Expose ALL modes from keyers.mjs in the UI — since the code is already there in the borrowed file, it costs nothing extra. A dropdown selector covers: Straight, Iambic B (default), Iambic A, Iambic, Bug, E-Bug, Ultimatic, Single Dot, Key-Ahead.

## Decided: Test/check UI inside the accordion
The Vail adapter accordion section will include a live test area:
- MIDI status indicator (device name, connected/disconnected)
- Dit and dah key press indicators (light up when paddle pressed) — or single indicator for straight key
- Decoded text output field (read-only) showing characters as they are decoded — confirms full pipeline works
- Sidetone is audio-only (just listen)

## Key design decisions
- Sidetone: reuse morsewalker's existing `yourSidetone` (Hz) and `yourVolume` fields — no separate keyer controls for now
- WPM: read from morsewalker's `yourSpeed` input field
- Decoded characters appended to whichever of responseField/infoField/infoField2 is currently focused (default: responseField)
- Settings (enable toggle, keyer mode) saved to localStorage alongside other morsewalker settings
- From `inputs.mjs`: only instantiate the **MIDI class** — do NOT use the Keyboard class (conflicts with morsewalker's Enter = Send shortcut)
- Accordion placement: after "Your Station Settings", before "Responding Station Settings"
- Error correction (miskeyinga character): deferred — user has their own idea for Phase 2

## Implementation status: Phase 1 COMPLETE (untested)

### Files added to src/js/
Copied from vail-master (untouched):
`time.mjs`, `audio.mjs`, `morse-pro.mjs`, `morse-pro-wpm.mjs`, `morse-pro-decoder.mjs`,
`morse-pro-decoder-adaptive.mjs`, `decoder.mjs`, `keyers.mjs`, `outputs.mjs`, `inputs.mjs`

New integration layer:
`vail-input.js` — MorseWalkerTransmitter + KeyerWrapper + public API (enable/disable/changeKeyerMode)

### Files modified
- `src/index.html` — new "Vail Adapter (MIDI Input)" accordion item (between Your Station Settings and Responding Station Settings) with: enable toggle, keyer mode dropdown, MIDI status badge, keying speed input, DIT/DAH/TX indicators, decoded test output field, clear button
- `src/js/app.js` — import from vail-input.js + localStorage restore/save + event wiring
- `src/css/style.css` — no changes needed (Bootstrap classes handle indicators)

### Speed settings (split — fully independent)
| Field | ID | Default | Controls |
|---|---|---|---|
| Playback Speed (WPM) | `yourSpeed` | 16 | How fast YOUR station's audio plays (CQ, exchange, TU) |
| Keying Speed (WPM)   | `vailSpeed` | 14 | Vail keyer dit duration + MIDI adapter + decoder WPM |

Both saved to localStorage. `vailSpeed` input is enabled/disabled together with the rest of the Vail controls.

### Key implementation notes
- KeyerWrapper sits between MIDI class and real keyer; handles Straight() (not in keyers.mjs) by mapping to Key(0, ...)
- KeyerWrapper.deactivate() makes stale MIDI listeners harmless after disable()
- Always uses adapter pass-through mode (SetKeyerMode(1)) so browser runs keyer logic
- Own AudioContext for sidetone — unaffected by morsewalker's stopAllAudio()
- Decoded text goes to vailTestOutput field AND the currently focused response field
- Sidetone uses existing yourSidetone (Hz) and yourVolume fields

### Next steps when user returns
1. User tests with `docker compose up` → `http://localhost:8080`
2. Fix any build/runtime errors found during testing
3. Phase 2 — Option B (key CQ to trigger CQ button, auto-submit on word gap, key TU)
4. Error correction idea from user (their own idea, deferred)

**Why:** User wants to practice CW contesting with a real key/paddle, not just typing. This matches how real CW operation works.
**How to apply:** All files are in place. On resuming, first check test results, then fix issues, then proceed to Phase 2.

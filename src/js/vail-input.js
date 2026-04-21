/**
 * Vail Adapter integration for MorseWalker.
 *
 * Bridges the Vail adapter (MIDI input) to MorseWalker's response fields.
 * Borrows keyer, sidetone, and decoder logic from vail-master — no rewrite needed.
 *
 * Two operating modes, matching how vail-master works:
 *
 *   Pass-through (straight / cootie, adapter mode 1):
 *     Paddle → MIDI Note 1/2 → Key(0/1) → KeyerWrapper → StraightKeyer → TX
 *
 *   Adapter-keyed (bug, iambic, etc., adapter mode > 1):
 *     Paddle → adapter runs keyer → MIDI Note 0 → Straight() → TX directly
 *     (browser keyer is bypassed; adapter hardware does the timing)
 */

import { Keyers, Numbers } from './keyers.mjs';
import { MIDI } from './inputs.mjs';
import { AudioOutput } from './outputs.mjs';
import { VailDecoder } from './decoder.mjs';

// ── Module state ──────────────────────────────────────────────────────────────

let audioCtx = null;
let audioOutput = null;
let decoder = null;
let keyerWrapper = null;   // KeyerWrapper instance (exposed to MIDI class)
let midiInput = null;
let enabled = false;
let txStartTime = null;
let commandHandler = null;    // set by setCommandHandler()
let wordBuffer = '';          // accumulates decoded chars between word gaps
let wordGapAutoSend = false;  // set by setWordGapAutoSend()
let autoSendTimer = null;
let kbkTimer = null;
const WORD_GAP_TIMEOUT_MS = 1500;

function getWordGapMs() {
  const wpm = parseInt(document.getElementById('vailSpeed')?.value, 10) || 20;
  return Math.round(8400 / wpm) + 150; // one word gap at current speed + small buffer
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function getWpm() {
  const el = document.getElementById('vailSpeed');
  return el ? Math.max(1, parseInt(el.value, 10) || 14) : 14;
}

function getSidetoneFreq() {
  const el = document.getElementById('yourSidetone');
  return el ? Math.max(50, parseInt(el.value, 10) || 600) : 600;
}

function getSidetoneVolume() {
  const el = document.getElementById('yourVolume');
  return el ? Math.min(100, Math.max(0, parseInt(el.value, 10) || 70)) / 100 : 0.7;
}

function getActiveInputField() {
  const focused = document.activeElement;
  const ids = ['responseField', 'infoField', 'infoField2'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el === focused && !el.disabled && el.style.display !== 'none') {
      return el;
    }
  }
  return null; // only type when a response field is explicitly focused
}

// ── Visual indicators ─────────────────────────────────────────────────────────

function setIndicator(id, active, activeClass = 'bg-primary') {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('bg-secondary', 'bg-primary', 'bg-success');
  el.classList.add(active ? activeClass : 'bg-secondary');
}

function updateMidiStatus(statusText) {
  const el = document.getElementById('vailMidiStatus');
  if (!el) return;
  if (!statusText || statusText === 'No MIDI') {
    el.textContent = 'No MIDI device found';
    el.className = 'badge bg-warning text-dark';
  } else {
    el.textContent = statusText;
    el.className = 'badge bg-success';
  }
}

// ── Command detection ─────────────────────────────────────────────────────────

// Returns 'strip' (command fired, remove trigger chars from field),
//         'keep'  (command fired, leave field as-is),
//         null    (no command matched).
function checkAndFireCommand(word) {
  if (!commandHandler) return null;
  const w = word.toUpperCase();
  const yourCallsign = (document.getElementById('yourCallsign')?.value || '').toUpperCase().trim();
  if (w === 'EEEE') { commandHandler('error'); return 'strip'; }
  if (w === 'CQ') { commandHandler('cq'); return 'strip'; }
  if (w === 'QRT' || (yourCallsign && w === yourCallsign + 'QRT')) { commandHandler('stop'); return 'strip'; }
  if (w === 'TU') { commandHandler('tu'); return 'strip'; }
  if (w === 'K') { commandHandler('k'); return 'keep'; }
  if (w === 'AGN' || w === 'QRS' || w.endsWith('?')) { commandHandler('send'); return 'keep'; }
  return null;
}

// ── Decoded text output ───────────────────────────────────────────────────────

function appendDecoded(text) {
  // Always show in the test output field inside the accordion
  const testOutput = document.getElementById('vailTestOutput');
  if (testOutput) testOutput.value += text;

  if (text === ' ') {
    // Word gap: cancel KN/BK timer (we'll handle it here instead)
    if (kbkTimer) { clearTimeout(kbkTimer); kbkTimer = null; }
    // Check for KN/BK send commands first, then clean up buffer
    const completedWord = wordBuffer.toUpperCase();
    wordBuffer = '';
    if (commandHandler && (completedWord === '<KN>' || completedWord === '<BK>')) {
      const field = getActiveInputField();
      if (field) {
        field.value = field.value.slice(0, -completedWord.length);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (autoSendTimer) { clearTimeout(autoSendTimer); autoSendTimer = null; }
      commandHandler('send');
      return;
    }
    const field = getActiveInputField();
    if (field) {
      field.value += ' ';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }

  // Non-space character
  wordBuffer += text;

  // Append to whichever response field is currently active
  const field = getActiveInputField();
  if (field) {
    field.value += text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Check command after every character — fires as soon as the word is complete,
  // without needing to wait for a word gap
  const cmdResult = checkAndFireCommand(wordBuffer);
  if (cmdResult) {
    if (cmdResult === 'strip' && field) field.value = field.value.slice(0, -wordBuffer.length);
    wordBuffer = '';
    if (autoSendTimer) { clearTimeout(autoSendTimer); autoSendTimer = null; }
    if (kbkTimer) { clearTimeout(kbkTimer); kbkTimer = null; }
    return;
  }

  // KN/BK prosigns: start a timer — fire send if no more characters arrive within one word gap.
  const wUpper = wordBuffer.toUpperCase();
  if (commandHandler && (wUpper === '<KN>' || wUpper === '<BK>')) {
    if (kbkTimer) clearTimeout(kbkTimer);
    kbkTimer = setTimeout(() => {
      kbkTimer = null;
      if (wordBuffer.toUpperCase() === '<KN>' || wordBuffer.toUpperCase() === '<BK>') {
        const f = getActiveInputField();
        if (f) {
          f.value = f.value.slice(0, -wordBuffer.length);
          f.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (autoSendTimer) { clearTimeout(autoSendTimer); autoSendTimer = null; }
        wordBuffer = '';
        commandHandler('send');
      }
    }, getWordGapMs());
  } else if (kbkTimer) {
    clearTimeout(kbkTimer);
    kbkTimer = null;
  }

  // Auto-send on word gap: reset timer after each decoded character
  if (wordGapAutoSend && commandHandler && field) {
    if (autoSendTimer) clearTimeout(autoSendTimer);
    autoSendTimer = setTimeout(() => {
      autoSendTimer = null;
      wordBuffer = '';
      commandHandler('send');
    }, WORD_GAP_TIMEOUT_MS);
  }
}

// ── Transmitter ───────────────────────────────────────────────────────────────
//
// Implements the Transmitter interface expected by keyers.mjs.
// Called by the keyer on every element start/end.

class MorseWalkerTransmitter {
  BeginTx() {
    txStartTime = Date.now();
    setIndicator('vailTxIndicator', true, 'bg-success');
    if (audioOutput) audioOutput.Buzz();
  }

  EndTx() {
    if (audioOutput) audioOutput.Silence();
    setIndicator('vailTxIndicator', false);

    if (txStartTime !== null) {
      const duration = Date.now() - txStartTime;
      const start = txStartTime;
      txStartTime = null;
      if (decoder && duration > 0) {
        decoder.addTone(duration, start);
      }
    }
  }
}

// ── Keyer wrapper ─────────────────────────────────────────────────────────────
//
// Sits between the MIDI class and the real keyer.
// - Updates visual dit/dah indicators on every key event.
// - Provides Straight() which the MIDI class calls for note 0 and adapter-keyed output.
// - Can be deactivated so stale MIDI listeners become harmless after disable().

class KeyerWrapper {
  /**
   * @param {object} realKeyer        - keyers.mjs keyer instance
   * @param {object} transmitter      - MorseWalkerTransmitter instance
   * @param {boolean} adapterIsKeying - true when adapter mode > 1 (adapter runs keyer)
   */
  constructor(realKeyer, transmitter, adapterIsKeying) {
    this.realKeyer = realKeyer;
    this.transmitter = transmitter;
    this.adapterIsKeying = adapterIsKeying;
    this.active = true;
  }

  Key(key, pressed) {
    if (!this.active) return;
    this.realKeyer.Key(key, pressed);
  }

  // MIDI class calls Straight() for Note 0 (raw straight key) and for all
  // adapter-keyed output (modes > 1 — adapter ran the keyer itself).
  //
  // When the adapter is keying (mode > 1): route directly to TX so we don't
  // double-key through the browser's iambic/bug logic.
  // When pass-through (mode 1): treat as key 0 on the straight keyer.
  Straight(pressed) {
    if (!this.active) return;
    if (this.adapterIsKeying) {
      // Adapter produced this element; just start/stop TX.
      if (pressed) this.transmitter.BeginTx();
      else this.transmitter.EndTx();
    } else {
      this.realKeyer.Key(0, pressed);
    }
  }

  SetDitDuration(d) {
    if (this.realKeyer) this.realKeyer.SetDitDuration(d);
  }

  Reset() {
    if (this.realKeyer) this.realKeyer.Reset();
  }

  Release() {
    if (this.realKeyer && this.realKeyer.Release) this.realKeyer.Release();
  }

  deactivate() {
    this.active = false;
    if (this.realKeyer) this.realKeyer.Reset();
  }
}

// ── Setting change handlers ───────────────────────────────────────────────────

function onSpeedChange() {
  const wpm = getWpm();
  const ditDuration = 1200 / wpm;
  if (keyerWrapper) keyerWrapper.SetDitDuration(ditDuration);
  if (midiInput) midiInput.SetDitDuration(ditDuration);
  if (decoder) decoder.setWPM(wpm);
}

function onSidetoneChange() {
  if (audioOutput) audioOutput.SetFrequency(getSidetoneFreq());
}

function onVolumeChange() {
  if (audioOutput) audioOutput.SetVolume(getSidetoneVolume());
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enable the Vail adapter with the given keyer mode.
 * If already enabled, restarts cleanly with the new mode.
 *
 * @param {string} keyerModeName - Key into Keyers map (e.g. 'iambicb', 'straight')
 */
export function enable(keyerModeName = 'iambicb') {
  if (enabled) disable();

  // Own AudioContext for sidetone — unaffected by morsewalker's stopAllAudio()
  audioCtx = new AudioContext();
  audioCtx.resume();

  audioOutput = new AudioOutput(audioCtx, {
    frequency: getSidetoneFreq(),
    volume: getSidetoneVolume(),
    feedbackEnabled: false,
  });

  decoder = new VailDecoder(
    (text) => appendDecoded(text),
    getWpm()
  );

  const transmitter = new MorseWalkerTransmitter();
  const KeyerClass = Keyers[keyerModeName] ?? Keyers['iambicb'];
  const realKeyer = new KeyerClass(transmitter);
  realKeyer.SetDitDuration(1200 / getWpm());

  // Use the adapter's native keyer mode number (matches what vail-master does).
  // Mode 1 (straight/cootie): adapter sends raw Note 1/2 paddle events — browser
  //   keyer handles timing.
  // Mode > 1 (bug, iambic, etc.): adapter runs keyer internally, sends Note 0
  //   for each element — browser routes Straight() directly to TX.
  const adapterMode = Numbers[keyerModeName] ?? 1;
  keyerWrapper = new KeyerWrapper(realKeyer, transmitter, adapterMode > 1);

  midiInput = new MIDI(keyerWrapper, updateMidiStatus);
  midiInput.SetKeyerMode(adapterMode);
  midiInput.SetDitDuration(1200 / getWpm());

  enabled = true;

  document.getElementById('vailSpeed')?.addEventListener('input', onSpeedChange);
  document.getElementById('yourSidetone')?.addEventListener('input', onSidetoneChange);
  document.getElementById('yourVolume')?.addEventListener('input', onVolumeChange);
}

/**
 * Disable the Vail adapter and clean up all resources.
 */
export function disable() {
  if (!enabled) return;

  document.getElementById('vailSpeed')?.removeEventListener('input', onSpeedChange);
  document.getElementById('yourSidetone')?.removeEventListener('input', onSidetoneChange);
  document.getElementById('yourVolume')?.removeEventListener('input', onVolumeChange);

  // Deactivate wrapper so any lingering MIDI callbacks become no-ops
  if (keyerWrapper) {
    keyerWrapper.deactivate();
    keyerWrapper.Release();
    keyerWrapper = null;
  }

  if (audioOutput) {
    audioOutput.Panic();
    audioOutput = null;
  }

  if (audioCtx) {
    audioCtx.close();
    audioCtx = null;
  }

  decoder = null;
  midiInput = null;
  enabled = false;
  txStartTime = null;
  wordBuffer = '';
  if (autoSendTimer) { clearTimeout(autoSendTimer); autoSendTimer = null; }
  if (kbkTimer) { clearTimeout(kbkTimer); kbkTimer = null; }

  // Reset all indicators
  setIndicator('vailTxIndicator', false);

  const statusEl = document.getElementById('vailMidiStatus');
  if (statusEl) {
    statusEl.textContent = 'Disabled';
    statusEl.className = 'badge bg-secondary';
  }
}

/**
 * Switch keyer mode while staying enabled.
 * @param {string} mode
 */
export function changeKeyerMode(mode) {
  if (enabled) enable(mode);
}

/**
 * Register a handler for decoded Morse commands.
 * Called with 'cq', 'stop', 'send', or 'tu' when the corresponding command is keyed.
 * @param {function} fn
 */
export function setCommandHandler(fn) {
  commandHandler = fn;
}

/**
 * Enable or disable auto-send after a word gap silence.
 * @param {boolean} enabled
 */
export function setWordGapAutoSend(enabled) {
  wordGapAutoSend = enabled;
  if (!enabled && autoSendTimer) {
    clearTimeout(autoSendTimer);
    autoSendTimer = null;
  }
}

/** @returns {boolean} */
export function isEnabled() {
  return enabled;
}

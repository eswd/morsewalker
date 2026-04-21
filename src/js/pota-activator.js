import {
  audioContext,
  createMorsePlayer,
  getAudioLock,
  updateAudioLock,
  isBackgroundStaticPlaying,
  createBackgroundStatic,
} from './audio.js';
import { getYourStation } from './stationGenerator.js';
import { getInputs } from './inputs.js';
import {
  addTableRow,
  updateActiveStations,
  addStations,
  respondWithAllStations,
} from './util.js';
import { compareStrings } from './util.js';

const STATE = {
  IDLE: 'idle',
  WAITING_FOR_EXCHANGE: 'waitingForExchange',
  EXCHANGE_SENT: 'exchangeSent',
};

let currentState = STATE.IDLE;
let hunters = [];
let workingHunter = null;
let yourStation = null;
let totalContacts = 0;
let attempts = 0;
let qsoStartTime = null;

export function reset() {
  currentState = STATE.IDLE;
  hunters = [];
  workingHunter = null;
  yourStation = null;
  totalContacts = 0;
  attempts = 0;
  qsoStartTime = null;
  updateActiveStations(0);
}

export function goOnAir() {
  if (!isBackgroundStaticPlaying()) createBackgroundStatic();
}

export function handleCommand(cmd, text) {
  switch (currentState) {
    case STATE.IDLE:
      if (cmd === 'k') fireCQ();
      break;

    case STATE.WAITING_FOR_EXCHANGE:
      // No audio lock check here — user can call back while hunters are still audible
      if (cmd === 'send') handleExchange(text);
      break;

    case STATE.EXCHANGE_SENT:
      if (getAudioLock()) return;
      if (cmd === 'tu') handleTU();
      break;
  }
}

function fireCQ() {
  const inputs = getInputs();
  if (!inputs) return;

  yourStation = getYourStation();

  hunters = [];
  addStations(hunters, inputs);
  hunters.forEach((h) => {
    h.player = createMorsePlayer(h);
  });
  respondWithAllStations(hunters, audioContext.currentTime);

  qsoStartTime = audioContext.currentTime;
  attempts = 0;
  currentState = STATE.WAITING_FOR_EXCHANGE;
}

function handleExchange(text) {
  if (hunters.length === 0) return;

  const upper = text.trim().toUpperCase();

  // AGN or ? → replay hunters
  if (upper === 'AGN' || upper === 'AGN?' || upper.endsWith('?')) {
    respondWithAllStations(hunters, audioContext.currentTime);
    attempts++;
    clearResponseField();
    return;
  }

  // Extract callsign: try all sliding windows of 1–5 adjacent words joined together.
  // This handles beginners who accidentally insert spaces inside a callsign (e.g. "K 7YR").
  const words = upper.split(/\s+/).filter(Boolean);
  let matched = null;
  for (let size = 1; size <= Math.min(words.length, 5) && !matched; size++) {
    for (let i = 0; i <= words.length - size && !matched; i++) {
      const candidate = words.slice(i, i + size).join('');
      for (const hunter of hunters) {
        if (compareStrings(hunter.callsign, candidate) === 'perfect') {
          matched = hunter;
          break;
        }
      }
    }
  }

  attempts++;
  clearResponseField();

  if (!matched) return; // silent ignore — nobody responds

  workingHunter = matched;

  const rst1 = workingHunter.rstCw;
  const rst2 = workingHunter.rstCw2;
  const stateStr = workingHunter.state
    ? ` ${workingHunter.state} ${workingHunter.state}`
    : '';
  const reply = `<BK> TU UR ${rst1} ${rst2}${stateStr} <BK>`;

  const t = workingHunter.player.playSentence(reply, audioContext.currentTime + 0.5);
  updateAudioLock(t);

  const infoField = document.getElementById('infoField');
  if (infoField) infoField.focus();

  currentState = STATE.EXCHANGE_SENT;
}

function handleTU() {
  if (!workingHunter) return;

  const infoField = document.getElementById('infoField');
  const infoField2 = document.getElementById('infoField2');
  const potaLogCallsign = document.getElementById('potaLogCallsign');
  const loggedCall = (potaLogCallsign?.value || '').replace(/\s+/g, '').toUpperCase();
  const rst = (infoField?.value || '').replace(/\s+/g, '').toUpperCase();
  const state = (infoField2?.value || '').replace(/\s+/g, '').toUpperCase();

  totalContacts++;

  let extraInfo = validateField(loggedCall, workingHunter.callsign.toUpperCase());
  extraInfo += ' / ' + validateField(rst, workingHunter.rst.toUpperCase());
  if (workingHunter.state) {
    extraInfo += ' / ' + validateField(state, workingHunter.state.toUpperCase());
  }

  const wpmStr =
    `${workingHunter.wpm}` +
    (workingHunter.enableFarnsworth ? ` / ${workingHunter.farnsworthSpeed}` : '');

  addTableRow(
    'resultsTable',
    totalContacts,
    workingHunter.callsign,
    wpmStr,
    attempts,
    audioContext.currentTime - qsoStartTime,
    extraInfo
  );

  const t = workingHunter.player.playSentence('dit dit', audioContext.currentTime + 0.25);
  updateAudioLock(t);

  hunters = hunters.filter((h) => h !== workingHunter);
  workingHunter = null;
  updateActiveStations(hunters.length);

  if (potaLogCallsign) potaLogCallsign.value = '';
  if (infoField) infoField.value = '';
  if (infoField2) infoField2.value = '';
  clearResponseField();

  if (totalContacts === 10) {
    setTimeout(() => {
      alert(`Activation complete! 10 QSOs logged. 73 de ${yourStation?.callsign || ''}`);
    }, 800);
  }

  if (hunters.length > 0) {
    respondWithAllStations(hunters, t);
    qsoStartTime = t;
    attempts = 0;
    currentState = STATE.WAITING_FOR_EXCHANGE;
  } else {
    currentState = STATE.IDLE;
  }
}

function validateField(userInput, expected) {
  if (!expected) return 'N/A';
  if (!userInput) {
    return `<span class="text-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i></span> (${expected})`;
  }
  const correct = userInput === expected;
  return correct
    ? `<span class="text-success"><i class="fa-solid fa-check me-1"></i><strong>${userInput}</strong></span>`
    : `<span class="text-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>${userInput}</span> (${expected})`;
}

function clearResponseField() {
  const rf = document.getElementById('responseField');
  if (rf) rf.value = '';
}

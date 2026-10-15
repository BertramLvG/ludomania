'use strict';

// Game settings the host can change in the lobby. This list drives everything:
// the server validates against it and the browser draws the controls from it (it is served as /settings.js).
// To add a setting, add one entry here.
//   toggle: on/off              slider: a whole number between min and max
//   requires: only active while that toggle is on
const DEFINITIONS = [
  { key: 'powerUps', type: 'toggle', label: 'Power-ups', hint: 'Reroll, Shield, Trap and Speed boost appear on the board.', default: false },
  {
    key: 'powerUpRate', type: 'slider', label: 'Spawn rate', min: 1, max: 10, step: 1, default: 5,
    low: 'Rare', high: 'Frequent', requires: 'powerUps',
  },
  {
    key: 'powerUpMax', type: 'slider', label: 'Most on the board at once', min: 1, max: 8, step: 1, default: 3,
    low: '1', high: '8', requires: 'powerUps',
  },
];

function defaults() {
  const out = {};
  for (const d of DEFINITIONS) out[d.key] = d.default;
  return out;
}

// Returns a full, valid settings object: values from `input` where they are valid (sliders are rounded and
// kept within their range), otherwise the value from `base`. Unknown keys are ignored.
function normalize(input, base = defaults()) {
  const out = { ...defaults(), ...base };
  if (!input || typeof input !== 'object') return out;
  for (const d of DEFINITIONS) {
    if (!Object.prototype.hasOwnProperty.call(input, d.key)) continue;
    const value = input[d.key];
    if (d.type === 'toggle') {
      if (typeof value === 'boolean') out[d.key] = value;
    } else if (d.type === 'slider') {
      const n = Number(value);
      if (typeof value !== 'boolean' && value !== null && value !== '' && Number.isFinite(n)) {
        const stepped = Math.round(n / d.step) * d.step;
        out[d.key] = Math.min(d.max, Math.max(d.min, stepped));
      }
    }
  }
  return out;
}

const GameSettings = { DEFINITIONS, defaults, normalize };

// Works both in Node (server, tests) and in the browser (served as /settings.js).
if (typeof module !== 'undefined' && module.exports) module.exports = GameSettings;
else window.GameSettings = GameSettings;

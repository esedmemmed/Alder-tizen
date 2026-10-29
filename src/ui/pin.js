/*
 * A PIN for a TV remote (Alder's askPin): four boxes, and the digits as an on-screen pad as well as the remote's number keys.
 * The fourth digit hands the PIN to [check]; a refusal shakes the boxes, clears them and says why.
 *
 *   const pin = createPinEntry({ title, errorMessage, check(pin) -> boolean })     check true: accepted (the caller moves on)
 *   pin.el        the whole block         pin.firstKey   what to focus first
 *   pin.key(evt)  a router key event: digits type, Back (nothing typed) is left to the caller; returns handled
 *   pin.entry     the digits typed so far
 */
import { h } from '../lib/dom.js';
import { isDigit } from '../lib/keys.js';

export const PIN_LENGTH = 4;

/** The typing rules without the DOM: digits fill in order, delete removes the last, the fourth completes. */
export function createPinState(length = PIN_LENGTH) {
  let digits = '';
  return {
    get value() { return digits; },
    get complete() { return digits.length === length; },
    add(d) { if (digits.length < length && /^[0-9]$/.test(String(d))) digits += d; return digits.length; },
    backspace() { digits = digits.slice(0, -1); return digits.length; },
    clear() { digits = ''; },
    length,
  };
}

export function createPinEntry({ title, errorMessage = 'Incorrect PIN. Try again.', check, subtitle = null }) {
  const state = createPinState();
  const boxes = Array.from({ length: PIN_LENGTH }, () => h('div', { class: 'pin-box' }));
  const row = h('div', { class: 'pin-boxes' }, boxes);
  const error = h('div', { class: 't-body pin-error' }, '');
  const keys = [];

  function draw() {
    boxes.forEach((b, i) => {
      b.textContent = i < state.value.length ? '•' : '';
      b.classList.toggle('now', i === Math.min(state.value.length, PIN_LENGTH - 1));
    });
  }

  function shake() {
    row.classList.remove('shake');
    void row.offsetWidth;
    row.classList.add('shake');
  }

  function submit() {
    if (!state.complete) return;
    if (check(state.value)) return;
    state.clear();
    draw();
    error.textContent = errorMessage;
    shake();
  }

  function type(d) {
    error.textContent = '';
    state.add(d);
    draw();
    if (state.complete) submit();
  }
  function erase() { error.textContent = ''; state.backspace(); draw(); }

  const pad = h('div', { class: 'pin-pad' });
  const add = (label, action, cls = '') => {
    const k = h('div', { class: 'osk-key pin-key ' + cls, 'data-focus': '', tabindex: '-1', role: 'button' }, label);
    k.addEventListener('click', action);
    pad.appendChild(k);
    keys.push(k);
  };
  '123456789'.split('').forEach((d) => add(d, () => type(d)));
  add('⌫', erase, 'small');
  add('0', () => type('0'));
  add('OK', submit, 'small');

  draw();
  const el = h('div', { class: 'pin' },
    h('div', { class: 't-title bold' }, title),
    subtitle ? h('div', { class: 't-body t-2 pin-sub' }, subtitle) : null,
    row, error, pad,
    h('div', { class: 't-small t-3 pin-hint' }, 'Type with the number keys or pick below'));

  return {
    el,
    firstKey: keys[4], // 5: the middle of the pad
    get entry() { return state.value; },
    key(evt) {
      if (evt.type !== 'press') return false;
      if (isDigit(evt.action)) { type(evt.action); return true; }
      return false;
    },
  };
}

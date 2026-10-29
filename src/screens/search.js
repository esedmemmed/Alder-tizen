/* STUB (Phase 4B): replaced by the real screen in a later commit. */
import { h } from '../lib/dom.js';

export function createSearchScreen() {
  return {
    mount(root) {
      root.appendChild(h('div', { class: 'screen-stub' }, 'search'));
    },
  };
}

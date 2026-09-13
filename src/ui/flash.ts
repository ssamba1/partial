import { FlashLimiter } from '../core/onsets';
import { getSettings } from '../store/settings';
import { h } from './dom';
import { metronome } from './shared';

/**
 * Beat flash for the whole app, so it works on every screen. It is shown with a class and
 * removed by a timer rather than a CSS animation, so reduced-motion settings (which shorten
 * animations) do not hide it. Accents flash stronger and longer, not only in another colour.
 * Flash rate is limited by FlashLimiter (WCAG 2.3.1).
 */
export function installFlash(parent: HTMLElement): void {
  const el = h('div', { class: 'screen-flash', 'aria-hidden': 'true' });
  parent.append(el);
  const limiter = new FlashLimiter();
  let timer = 0;
  metronome.onState((playing) => {
    if (!playing) {
      limiter.reset();
      el.classList.remove('go', 'accent');
    }
  });
  metronome.onBeat((e) => {
    const m = getSettings().metronome;
    if (!m.flashScreen || e.layer || e.sub !== 0 || e.level === 'silent') return;
    if (!limiter.allow(performance.now(), e.bpm, e.beat === 0)) return;
    const accent = e.level === 'accent';
    el.dataset.style = m.flashStyle;
    el.classList.add('go');
    el.classList.toggle('accent', accent);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => el.classList.remove('go', 'accent'), accent ? 180 : 100);
  });
}

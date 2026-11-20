// Opening titles: a short count while the fonts and first frame arrive, then
// the black screen parts like a film gate to reveal the hero.

import { $ } from '../lib/dom.js';
import { gsap, lockScroll, reduceMotion } from '../lib/motion.js';

const SEEN_KEY = 'mae.seen-titles';
const MAX_WAIT_MS = 2600;

function firstFrameReady() {
  const poster = $('[data-hero-video]')?.poster;
  const image = new Image();
  if (!poster) return Promise.resolve();
  image.src = poster;
  return image.decode().catch(() => {});
}

/**
 * Resolves at the moment the screen starts to open, so the hero's title
 * sequence can begin in step with it.
 */
export function runPreloader() {
  const root = $('[data-preloader]');
  if (!root) return Promise.resolve();
  if (reduceMotion) {
    root.remove();
    return Promise.resolve();
  }

  let seen = false;
  try {
    seen = sessionStorage.getItem(SEEN_KEY) === '1';
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable: play the full titles */
  }

  lockScroll(true);
  const count = $('[data-preloader-count]', root);
  const bar = $('[data-preloader-bar]', root);
  const progress = { value: 0 };

  const ready = Promise.race([
    Promise.all([document.fonts?.ready, firstFrameReady()]),
    new Promise((resolve) => window.setTimeout(resolve, MAX_WAIT_MS)),
  ]);

  return new Promise((resolve) => {
    const counting = gsap.to(progress, {
      value: 100,
      duration: seen ? 0.6 : 1.5, // returning in the same session: get out of the way
      ease: 'power2.inOut',
      onUpdate() {
        count.textContent = String(Math.round(progress.value)).padStart(2, '0');
        bar.style.transform = `scaleX(${progress.value / 100})`;
      },
    });

    Promise.all([counting.then(), ready]).then(() => {
      gsap
        .timeline({ onComplete: () => root.remove() })
        .to('.preloader__content', { opacity: 0, y: -14, duration: 0.4, ease: 'power2.in' })
        .add(() => {
          lockScroll(false);
          resolve();
        })
        .to('.preloader__half--top', { yPercent: -100, duration: 1.15, ease: 'expo.inOut' }, '>-0.05')
        .to('.preloader__half--bottom', { yPercent: 100, duration: 1.15, ease: 'expo.inOut' }, '<');
    });
  });
}

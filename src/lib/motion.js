// Animation plumbing shared by every module: GSAP, smooth scrolling and the
// media queries that decide how much motion a visitor gets.

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

gsap.registerPlugin(ScrollTrigger, SplitText);
gsap.defaults({ ease: 'expo.out', duration: 1 });

export { gsap, ScrollTrigger, SplitText };

export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Matches the hero's "stage" layout in hero.css. */
export const STAGE_QUERY = '(min-width: 900px) and (min-aspect-ratio: 11/10)';

let lenis = null;

/**
 * Weighted, cinematic wheel scrolling for mouse users. Touch devices keep
 * their native scrolling, and so does anyone who asked for reduced motion.
 */
export function startSmoothScroll() {
  if (reduceMotion || !finePointer) return;
  lenis = new Lenis({ lerp: 0.11, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

/** Current scroll speed in px/frame-ish units, 0 when smooth scrolling is off. */
export function scrollVelocity() {
  return lenis ? lenis.velocity : 0;
}

export function lockScroll(locked) {
  document.documentElement.classList.toggle('is-loading', locked);
  if (!lenis) return;
  if (locked) lenis.stop();
  else lenis.start();
}

export function scrollToEl(target, { offset = 0, immediate = false } = {}) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) return;
  if (lenis) {
    lenis.scrollTo(el, { offset, immediate, duration: 1.5, easing: (t) => 1 - (1 - t) ** 4 });
    return;
  }
  const top = el.getBoundingClientRect().top + window.scrollY + offset;
  window.scrollTo({ top, behavior: immediate || reduceMotion ? 'auto' : 'smooth' });
}

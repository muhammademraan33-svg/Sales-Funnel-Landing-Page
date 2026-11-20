// The opening scene: footage, the Vice City set behind it, the light the
// footage throws onto the set, and the title sequence.

import { $, $$ } from '../lib/dom.js';
import { gsap, ScrollTrigger, STAGE_QUERY, finePointer, reduceMotion } from '../lib/motion.js';
import { buildScene } from './scene.js';

/** Picks the lighter encode for small, low-density screens and slow connections. */
function pickSource(video) {
  const connection = navigator.connection;
  if (connection?.saveData) return null; // Data Saver on: keep the still frame
  const slow = /(^|-)(2g|3g)$/.test(connection?.effectiveType || '');
  const small = window.innerWidth <= 480 && window.devicePixelRatio <= 2;
  return slow || small ? video.dataset.srcSm : video.dataset.srcLg;
}

function startVideo(video) {
  if (reduceMotion) return;
  const src = pickSource(video);
  if (!src) return;
  video.muted = true;
  video.src = src;
  video.play().catch(() => {
    /* autoplay refused (e.g. Low Power Mode): the poster frame stays */
  });
}

/**
 * Ambient light: the current frame, drawn tiny and blurred behind the screen,
 * so the set glows pink at sunset and teal over open water.
 */
function startAmbient(video, canvas) {
  const context = canvas.getContext('2d');
  const paint = (source) => {
    try {
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
    } catch {
      /* frame not decodable yet */
    }
  };

  const still = new Image();
  still.onload = () => paint(still);
  still.src = video.poster;

  const timer = window.setInterval(() => {
    if (!video.paused && video.readyState >= 2) paint(video);
  }, 110);
  return () => window.clearInterval(timer);
}

export function initHero() {
  const hero = $('[data-hero]');
  if (!hero) return { intro() {} };

  const video = $('[data-hero-video]', hero);
  const screen = $('[data-screen]', hero);
  const title = $('.hero__title', hero);
  const letters = $$('.hero__letters span', hero);
  const script = $('[data-hero-script]', hero);
  const rules = $$('[data-hero-rule]', hero);
  const fades = $$('[data-hero-fade]', hero);
  const header = $('[data-header]');
  const curtain = $('[data-curtain]');

  startVideo(video);

  // The header waits off-screen for the title sequence. It is moved by a CSS
  // class, not by GSAP: it already has a CSS transition for hiding on scroll,
  // and one element should only ever be animated by one system.
  if (header && !reduceMotion && $('[data-preloader]')) {
    header.classList.add('is-waiting');
    // whatever happens to the titles, never leave the page without its header
    window.setTimeout(() => header.classList.remove('is-waiting'), 9000);
  }

  const media = gsap.matchMedia();

  // ---- stage layout only: build the set, light it, add depth on mouse move
  media.add(STAGE_QUERY, () => {
    buildScene();
    const stopAmbient = startAmbient(video, $('[data-ambient]', hero));
    if (reduceMotion || !finePointer) return stopAmbient;

    // Each animation owns its own properties so they never fight:
    // mouse depth = x/y, scroll = yPercent/scale, title sequence = the rest.
    const layers = [
      [screen, 18, 12],
      [title, -22, -10],
      [$('[data-skyline]', hero), 14, 0],
      [$('[data-palm="l1"]', hero), 46, 10],
      [$('[data-palm="r1"]', hero), 46, 10],
      [$('[data-palm="l2"]', hero), 28, 6],
    ]
      .filter(([node]) => node)
      .map(([node, dx, dy]) => ({
        x: gsap.quickTo(node, 'x', { duration: 1.1, ease: 'power3.out' }),
        y: gsap.quickTo(node, 'y', { duration: 1.1, ease: 'power3.out' }),
        dx,
        dy,
      }));

    const onMove = (event) => {
      const nx = event.clientX / window.innerWidth - 0.5;
      const ny = event.clientY / window.innerHeight - 0.5;
      for (const layer of layers) {
        layer.x(-nx * layer.dx);
        layer.y(-ny * layer.dy);
      }
    };
    hero.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      stopAmbient();
      hero.removeEventListener('pointermove', onMove);
    };
  });

  // ---- as the page slides up over the hero, the scene drifts and dims
  if (curtain) {
    ScrollTrigger.create({
      trigger: curtain,
      start: 'top top',
      // once covered, stop decoding video nobody can see
      onEnter: () => video.pause(),
      onLeaveBack: () => {
        if (video.src && !reduceMotion) video.play().catch(() => {});
      },
    });

    if (!reduceMotion) {
      gsap
        .timeline({ scrollTrigger: { trigger: curtain, start: 'top bottom', end: 'top top', scrub: true }, defaults: { ease: 'none' } })
        .to(title, { yPercent: -22 }, 0)
        .to('.hero__bottom', { yPercent: -60, opacity: 0 }, 0)
        .to(video, { scale: 1.14 }, 0)
        .to(hero, { '--dim': 0.72 }, 0);

      media.add(STAGE_QUERY, () => {
        gsap
          .timeline({ scrollTrigger: { trigger: curtain, start: 'top bottom', end: 'top top', scrub: true }, defaults: { ease: 'none' } })
          .to('[data-sun], .scene__sun-glow', { yPercent: 26 }, 0)
          .to(screen, { yPercent: -8 }, 0);
      });
    }
  }

  /** The title sequence, played as the opening titles part. */
  function intro() {
    if (reduceMotion) {
      header?.classList.remove('is-waiting');
      return;
    }
    const stage = window.matchMedia(STAGE_QUERY).matches;
    const timeline = gsap.timeline({ defaults: { ease: 'expo.out' } });

    timeline
      .add(() => header?.classList.remove('is-waiting'), 0.7)
      .from(letters, { yPercent: 118, rotate: 5, duration: 1.35, stagger: 0.075 }, 0.15)
      .from(script, { opacity: 0, xPercent: -14, duration: 0.9 }, 0.7)
      .add(() => script.classList.add('is-flickering'), 0.7)
      .from(rules, { scaleX: 0, duration: 1.2, ease: 'expo.inOut' }, 0.75)
      .from(fades, { opacity: 0, y: 24, duration: 1.1, stagger: 0.08 }, 0.9);

    if (stage) {
      timeline
        .from(screen, { opacity: 0, scale: 0.86, rotate: 5, duration: 1.7 }, 0)
        .from('[data-sun], .scene__sun-glow', { y: () => window.innerHeight * 0.22, duration: 2.6, ease: 'power3.out' }, 0)
        .from('[data-skyline]', { yPercent: 100, duration: 1.4 }, 0.15)
        .from('[data-palm]', { yPercent: 14, opacity: 0, duration: 1.6, stagger: 0.1 }, 0.2);
    } else {
      timeline.from('.hero__screen-clip', { scale: 1.22, duration: 2.6, ease: 'power3.out' }, 0);
    }
  }

  return { intro };
}

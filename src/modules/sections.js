// Scroll choreography for the sections between the hero and the box office.

import { $, $$, el } from '../lib/dom.js';
import { gsap, ScrollTrigger, SplitText, STAGE_QUERY, finePointer, reduceMotion } from '../lib/motion.js';

/* ----------------------------------------------------------------- tape -- */

/** Two crossed marquee tapes that speed up with the scroll. */
function initMarquee() {
  const bands = $$('[data-marquee]').map((band) => {
    const track = $('.tape__track', band);
    const set = Array.from(track.children);
    const setWidth = track.scrollWidth;
    const copies = Math.ceil((band.offsetWidth * 1.6) / setWidth) + 1;
    for (let i = 0; i < copies; i += 1) set.forEach((node) => track.append(node.cloneNode(true)));
    return { band, track, setWidth, direction: Number(band.dataset.marquee) || 1 };
  });
  if (reduceMotion) return;

  const tweens = bands.map(({ track, setWidth, direction }) =>
    gsap.fromTo(
      track,
      { x: direction > 0 ? 0 : -setWidth },
      { x: direction > 0 ? -setWidth : 0, duration: setWidth / 60, ease: 'none', repeat: -1 },
    ),
  );

  // Scroll speed feeds the tape speed, then eases back to cruising.
  let lastY = window.scrollY;
  let boost = 0;
  let visible = true;
  ScrollTrigger.create({
    trigger: bands[0].band,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => {
      visible = self.isActive;
      tweens.forEach((tween) => tween.paused(!visible));
    },
  });
  gsap.ticker.add(() => {
    const y = window.scrollY;
    boost += (Math.min(Math.abs(y - lastY) * 0.18, 6) - boost) * 0.12;
    lastY = y;
    if (visible) tweens.forEach((tween) => tween.timeScale(1 + boost));
  });
}

/* ------------------------------------------------------------ statement -- */

/** The pitch lights up word by word as it is scrolled through. */
function initStatement() {
  const statement = $('[data-statement]');
  if (!statement || reduceMotion) return;
  const split = new SplitText(statement, { type: 'words', wordsClass: 'word' });
  gsap.fromTo(
    split.words,
    { opacity: 0.13 },
    {
      opacity: 1,
      ease: 'none',
      stagger: 0.1,
      scrollTrigger: { trigger: statement, start: 'top 84%', end: 'bottom 58%', scrub: 0.5 },
    },
  );
}

/* --------------------------------------------------------------- titles -- */

/** Section titles: letters rise from behind a mask, the neon script flickers on. */
function initTitles() {
  for (const title of $$('[data-title]')) {
    const script = $('.script', title);
    // Wrap the plain text so only it is split into letters.
    const text = Array.from(title.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => {
        const value = node.textContent.trim();
        node.remove();
        return value;
      })
      .filter(Boolean)
      .join(' ');
    const span = el('span', { class: 'section-title__text' }, text);
    title.append(span);
    if (reduceMotion) continue;

    const split = new SplitText(span, { type: 'words,chars', wordsClass: 'word', charsClass: 'char', mask: 'words' });
    const trigger = { trigger: title, start: 'top 88%', once: true };
    gsap.from(split.chars, { yPercent: 118, duration: 1.1, stagger: 0.028, scrollTrigger: trigger });
    if (script) {
      gsap.from(script, {
        opacity: 0,
        xPercent: -16,
        duration: 0.9,
        delay: 0.4,
        scrollTrigger: trigger,
        onStart: () => script.classList.add('is-flickering'),
      });
    }
  }
}

/* -------------------------------------------------------------- reveals -- */

function initReveals() {
  if (reduceMotion) return;
  const items = $$('[data-reveal]');
  gsap.set(items, { opacity: 0, y: 34 });
  ScrollTrigger.batch(items, {
    start: 'top 90%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 1.2, stagger: 0.1, overwrite: true }),
  });

  // Figures count up the first time they are seen.
  for (const node of $$('[data-count]')) {
    const target = Number(node.dataset.count);
    const counter = { value: 0 };
    gsap.to(counter, {
      value: target,
      duration: 1.6,
      ease: 'power3.out',
      scrollTrigger: { trigger: node, start: 'top 92%', once: true },
      onUpdate: () => {
        node.textContent = String(Math.round(counter.value));
      },
    });
  }
}

/* ---------------------------------------------------------------- rides -- */

function initRides() {
  for (const ride of $$('.ride')) {
    const poster = $('.poster', ride);
    const video = $('video', poster);
    const number = $('.poster__num', ride);
    const direction = ride.classList.contains('ride--foil') ? -1 : 1;

    if (!reduceMotion) {
      gsap
        .timeline({ scrollTrigger: { trigger: ride, start: 'top 80%', once: true } })
        .from(poster, { opacity: 0, yPercent: 12, rotate: direction * 5, duration: 1.5 }, 0)
        .from(number, { xPercent: direction * -45, opacity: 0, duration: 1.3 }, 0.25)
        .from($$('.ride__body > *', ride), { opacity: 0, y: 32, duration: 1.1, stagger: 0.09 }, 0.2);

      // the footage drifts inside its frame as the poster passes
      gsap.fromTo(
        video,
        { yPercent: -5 },
        { yPercent: 5, ease: 'none', scrollTrigger: { trigger: poster, start: 'top bottom', end: 'bottom top', scrub: true } },
      );
    }

    // posters lean towards the pointer
    if (finePointer && !reduceMotion) {
      gsap.set(poster, { transformPerspective: 1100 });
      const tiltX = gsap.quickTo(poster, 'rotationX', { duration: 0.9, ease: 'power3.out' });
      const tiltY = gsap.quickTo(poster, 'rotationY', { duration: 0.9, ease: 'power3.out' });
      poster.addEventListener(
        'pointermove',
        (event) => {
          const box = poster.getBoundingClientRect();
          tiltY(((event.clientX - box.left) / box.width - 0.5) * 12);
          tiltX(-((event.clientY - box.top) / box.height - 0.5) * 9);
        },
        { passive: true },
      );
      poster.addEventListener('pointerleave', () => {
        tiltX(0);
        tiltY(0);
      });
    }
  }
}

/* ----------------------------------------------------------------- reel -- */

/**
 * The film strip. With a mouse on a landscape screen it is pinned and driven
 * by vertical scroll; on touch it is a native swipe with snap points.
 */
function initReel() {
  const section = $('[data-reel]');
  if (!section) return;
  const viewport = $('[data-reel-viewport]', section);
  const track = $('[data-reel-track]', section);

  // Photos further along the strip are fetched once the strip is close.
  if ('IntersectionObserver' in window) {
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        $$('img[loading="lazy"]', track).forEach((img) => {
          img.loading = 'eager';
        });
        near.disconnect();
      },
      { rootMargin: '100% 0px' },
    );
    near.observe(section);
  }

  if (reduceMotion) return;
  gsap.matchMedia().add(`${STAGE_QUERY} and (hover: hover) and (pointer: fine)`, () => {
    section.classList.add('is-pinned');
    viewport.dataset.cursor = 'Scroll';
    const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);
    gsap.to(track, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: {
        trigger: viewport,
        start: 'center center',
        end: () => `+=${distance()}`,
        pin: true,
        scrub: 0.7,
        anticipatePin: 1,
        invalidateOnRefresh: true,
      },
    });
    return () => {
      section.classList.remove('is-pinned');
      delete viewport.dataset.cursor;
    };
  });
}

export function initSections() {
  initStatement();
  initTitles();
  initReveals();
  initRides();
  initReel();
}

/** Needs final text metrics, so it runs once the fonts are in. */
export { initMarquee };

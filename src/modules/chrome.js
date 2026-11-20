// Page furniture: header, in-page navigation, the mobile booking bar, the
// contextual cursor label, magnetic buttons and the Miami clock.

import { BUSINESS } from '../../shared/booking.js';
import { $, $$ } from '../lib/dom.js';
import { finePointer, gsap, reduceMotion, scrollToEl } from '../lib/motion.js';

function initHeader() {
  const header = $('[data-header]');
  if (!header) return;
  let lastY = window.scrollY;
  const update = () => {
    const y = window.scrollY;
    header.classList.toggle('is-solid', y > 24);
    // Step aside while reading down the page, come back on the way up.
    if (y > window.innerHeight * 0.7 && y - lastY > 6) header.classList.add('is-hidden');
    else if (lastY - y > 6 || y < window.innerHeight * 0.7) header.classList.remove('is-hidden');
    lastY = y;
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

/** Same-page links glide; "book" links also hand the chosen ride to the funnel. */
function initLinks(openBooking) {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = link.getAttribute('href');
    if (target.length < 2 || !document.querySelector(target)) return;
    event.preventDefault();
    if (link.hasAttribute('data-book')) openBooking(link.dataset.book || null);
    else scrollToEl(target);
    history.replaceState(null, '', target === '#top' ? location.pathname + location.search : target);
  });
}

/** The booking bar on small screens: there after the hero, gone once the box office is on screen. */
function initDock() {
  const dock = $('[data-dock]');
  const booking = $('#book');
  if (!dock || !booking || !('IntersectionObserver' in window)) return;
  let pastHero = false;
  let atBooking = false;
  const update = () => dock.classList.toggle('is-visible', pastHero && !atBooking);
  const onScroll = () => {
    const next = window.scrollY > window.innerHeight * 0.85;
    if (next === pastHero) return;
    pastHero = next;
    update();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  // "At booking" from the moment the section appears until the page ends.
  new IntersectionObserver(
    ([entry]) => {
      atBooking = entry.isIntersecting || entry.boundingClientRect.top < 0;
      update();
    },
    { threshold: [0, 0.01] },
  ).observe(booking);
}

/** A sunset disc that follows the pointer over things worth clicking, with a one-word label. */
function initCursor() {
  const cursor = $('[data-cursor-el]');
  if (!cursor || !finePointer || reduceMotion) return;
  const label = $('[data-cursor-label]', cursor);
  const moveX = gsap.quickTo(cursor, 'x', { duration: 0.45, ease: 'power3.out' });
  const moveY = gsap.quickTo(cursor, 'y', { duration: 0.45, ease: 'power3.out' });
  window.addEventListener(
    'pointermove',
    (event) => {
      moveX(event.clientX);
      moveY(event.clientY);
      const host = event.target.closest?.('[data-cursor]');
      if (host) label.textContent = host.dataset.cursor;
      cursor.classList.toggle('is-on', Boolean(host));
    },
    { passive: true },
  );
  document.addEventListener('pointerleave', () => cursor.classList.remove('is-on'));
}

function initMagnets() {
  if (!finePointer || reduceMotion) return;
  for (const button of $$('[data-magnetic]')) {
    const moveX = gsap.quickTo(button, 'x', { duration: 0.6, ease: 'power3.out' });
    const moveY = gsap.quickTo(button, 'y', { duration: 0.6, ease: 'power3.out' });
    button.addEventListener(
      'pointermove',
      (event) => {
        const box = button.getBoundingClientRect();
        moveX((event.clientX - (box.left + box.width / 2)) * 0.22);
        moveY((event.clientY - (box.top + box.height / 2)) * 0.32);
      },
      { passive: true },
    );
    button.addEventListener('pointerleave', () => {
      moveX(0);
      moveY(0);
    });
  }
}

/** The time in Miami right now, where the sessions happen. */
function initClock() {
  const clock = $('[data-clock]');
  if (!clock) return;
  const format = new Intl.DateTimeFormat('en-US', { timeZone: BUSINESS.timeZone, hour: 'numeric', minute: '2-digit' });
  const tick = () => {
    clock.textContent = `Miami ${format.format(new Date())}`;
  };
  tick();
  window.setInterval(tick, 20_000);
}

export function initChrome({ openBooking }) {
  initHeader();
  initLinks(openBooking);
  initDock();
  initCursor();
  initMagnets();
  initClock();
  for (const node of $$('[data-year]')) node.textContent = String(new Date().getFullYear());
}

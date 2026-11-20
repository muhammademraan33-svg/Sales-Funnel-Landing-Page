// The mini calendar. Days are judged against Miami time: a day is open while
// it still has a start time that can be booked.

import { RULES, businessNow, isDateBookable, parseISODate, toISODate } from '../../../shared/booking.js';
import { $, el } from '../../lib/dom.js';
import { gsap, reduceMotion } from '../../lib/motion.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function addDays({ y, m, d }, days) {
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

const monthNumber = ({ y, m }) => y * 12 + (m - 1);

export function longDate(iso) {
  const { y, m, d } = parseISODate(iso);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function createCalendar(root, { onSelect }) {
  const title = $('[data-cal-title]', root);
  const grid = $('[data-cal-grid]', root);
  const previous = $('[data-cal-prev]', root);
  const next = $('[data-cal-next]', root);

  let today = businessNow();
  let view = { y: today.y, m: today.m };
  let selected = null;

  const lastDay = () => addDays(today, RULES.maxAdvanceDays);

  function render({ animate = false, focus = null } = {}) {
    const now = new Date();
    today = businessNow(now);
    // never show a month that is entirely in the past or beyond the window
    const min = monthNumber(today);
    const max = monthNumber(lastDay());
    if (monthNumber(view) < min) view = { y: today.y, m: today.m };
    if (monthNumber(view) > max) view = { y: lastDay().y, m: lastDay().m };

    previous.disabled = monthNumber(view) <= min;
    next.disabled = monthNumber(view) >= max;
    title.textContent = `${MONTHS[view.m - 1]} ${view.y}`;

    const daysInMonth = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
    const leading = new Date(Date.UTC(view.y, view.m - 1, 1)).getUTCDay();
    const cells = [];
    for (let i = 0; i < leading; i += 1) cells.push(el('span', { 'aria-hidden': 'true' }));

    let firstOpen = null;
    for (let d = 1; d <= daysInMonth; d += 1) {
      const iso = toISODate({ y: view.y, m: view.m, d });
      const open = isDateBookable(iso, now);
      const isToday = today.y === view.y && today.m === view.m && today.d === d;
      if (open && !firstOpen) firstOpen = iso;
      cells.push(
        el(
          'button',
          {
            type: 'button',
            class: `day${isToday ? ' is-today' : ''}`,
            dataset: { date: iso },
            disabled: !open,
            tabindex: '-1',
            'aria-pressed': String(iso === selected),
            'aria-label': `${longDate(iso)}${isToday ? ', today' : ''}${open ? '' : ', not available'}`,
          },
          d,
        ),
      );
    }
    grid.replaceChildren(...cells);

    // One tab stop for the grid; arrow keys move between days.
    const tabStop = grid.querySelector(`[data-date="${selected}"]:not(:disabled)`) || grid.querySelector(`[data-date="${firstOpen}"]`);
    tabStop?.setAttribute('tabindex', '0');

    if (animate && !reduceMotion) {
      gsap.from(grid.querySelectorAll('.day'), { opacity: 0, y: 8, duration: 0.4, ease: 'power2.out', stagger: 0.008 });
    }
    if (focus) grid.querySelector(`[data-date="${focus}"]`)?.focus();
  }

  function shiftMonth(delta) {
    const date = new Date(Date.UTC(view.y, view.m - 1 + delta, 1));
    view = { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1 };
    render({ animate: true });
  }

  function select(iso, { notify = true } = {}) {
    selected = iso;
    if (iso) {
      const date = parseISODate(iso);
      view = { y: date.y, m: date.m };
    }
    render();
    if (notify && iso) onSelect(iso);
  }

  previous.addEventListener('click', () => shiftMonth(-1));
  next.addEventListener('click', () => shiftMonth(1));

  grid.addEventListener('click', (event) => {
    const day = event.target.closest('.day');
    if (!day || day.disabled) return;
    select(day.dataset.date);
    grid.querySelector(`[data-date="${day.dataset.date}"]`)?.focus();
  });

  grid.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    const from = event.target.closest?.('.day')?.dataset.date;
    if (!step || !from) return;
    event.preventDefault();
    // walk in that direction to the next day that can be booked
    let cursor = parseISODate(from);
    const now = new Date();
    for (let i = 0; i < 62; i += 1) {
      cursor = addDays(cursor, step);
      const iso = toISODate(cursor);
      const ahead = monthNumber(cursor) - monthNumber(businessNow(now));
      if (ahead < 0 || monthNumber(cursor) > monthNumber(lastDay())) return;
      if (isDateBookable(iso, now)) {
        view = { y: cursor.y, m: cursor.m };
        render({ focus: iso });
        grid.querySelectorAll('.day').forEach((day) => day.setAttribute('tabindex', day.dataset.date === iso ? '0' : '-1'));
        return;
      }
    }
  });

  render();
  return { render, select };
}

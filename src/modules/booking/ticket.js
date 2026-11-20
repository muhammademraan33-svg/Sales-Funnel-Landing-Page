// The ticket: fills in beside the form as choices are made, and is handed
// over, complete, on the confirmation screen.

import { BUSINESS } from '../../../shared/booking.js';
import { el } from '../../lib/dom.js';

/** Decorative bars derived from the booking reference. Not a scannable code. */
function bars(text) {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const nodes = [];
  for (let i = 0; i < 48; i += 1) {
    hash ^= hash << 13;
    hash ^= hash >>> 17;
    hash ^= hash << 5;
    const bar = el('i');
    bar.style.flexGrow = String(1 + ((hash >>> 3) & 3));
    if (i % 2) bar.style.opacity = '0';
    nodes.push(bar);
  }
  return nodes;
}

function field(label, value, placeholder, wide = false) {
  return el('div', { class: wide ? 'wide' : null }, el('dt', {}, label), el('dd', { class: value ? null : 'is-empty' }, value || placeholder));
}

/**
 * ticket: { serviceName, dateLabel, startLabel, endLabel, guests, names,
 *           reference, totalLabel, stamp }   (anything may be missing)
 */
export function renderTicket(root, ticket, { shine = false } = {}) {
  const names = (ticket.names || []).filter(Boolean);
  root.replaceChildren(
    el(
      'div',
      { class: 'ticket__inner' },
      el(
        'div',
        { class: 'ticket__main' },
        el('div', { class: 'ticket__top' }, el('span', {}, BUSINESS.name), el('span', { class: 'ticket__admit' }, 'Admit', el('b', {}, ticket.guests ?? '-'))),
        el('p', { class: `ticket__ride display${ticket.serviceName ? '' : ' is-empty'}` }, ticket.serviceName || 'Your ride'),
        el(
          'dl',
          { class: 'ticket__grid' },
          field('Date', ticket.dateLabel, 'Pick a date'),
          field('Starts', ticket.startLabel, '--:--'),
          field('Ends', ticket.endLabel, '--:--'),
          field('Crew', names.join(', '), 'Add your crew', true),
          field('Where', BUSINESS.location, '', true),
        ),
      ),
      el(
        'div',
        { class: 'ticket__stub' },
        el('div', { class: 'ticket__code', 'aria-hidden': 'true' }, bars(ticket.reference || BUSINESS.name)),
        el('div', { class: 'ticket__ref' }, el('span', {}, 'Booking ref'), el('b', {}, ticket.reference || 'On confirmation')),
        el('div', { class: 'ticket__total' }, el('span', {}, 'Total'), el('b', { class: 'display' }, ticket.totalLabel || '-')),
      ),
      ticket.stamp ? el('span', { class: 'ticket__stamp' }, ticket.stamp) : null,
    ),
  );

  if (shine) {
    root.classList.remove('is-shining');
    void root.offsetWidth; // restart the sheen
    root.classList.add('is-shining');
  }
}

// The booking funnel: ride -> date and start time -> crew -> review and pay
// -> ticket. All rules (prices, start times, what counts as valid) come from
// shared/booking.js, the same module the payment endpoint uses.

import {
  BUSINESS,
  RULES,
  SERVICES,
  TIME_SLOTS,
  bookableSlots,
  businessTimeToUtc,
  cleanName,
  formatMoney,
  formatTime,
  getSlot,
  isSlotBookable,
  isValidName,
  normalizePhone,
  parseISODate,
  slotEnd,
  totalCents,
  validateBooking,
} from '../../../shared/booking.js';
import { PAYMENTS } from '../../config.js';
import { $, $$, el } from '../../lib/dom.js';
import { gsap, reduceMotion, scrollToEl } from '../../lib/motion.js';
import { createCalendar, longDate } from './calendar.js';
import { buildIcs, downloadIcs } from './ics.js';
import { renderTicket } from './ticket.js';

const STORAGE_KEY = 'mae.booking.v1';
const LAST_STEP = 3;
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const blankState = () => ({ step: 0, serviceId: null, date: null, slotId: null, guests: 1, names: [''], phone: '' });

/** "Sat, Dec 5, 2026" */
function shortDate(iso) {
  const { y, m, d } = parseISODate(iso);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

const people = (count) => `${count} ${count === 1 ? 'person' : 'people'}`;

function localReference() {
  const values = crypto.getRandomValues(new Uint32Array(6));
  return `MAE-${Array.from(values, (value) => REFERENCE_ALPHABET[value % REFERENCE_ALPHABET.length]).join('')}`;
}

let api = { open() {} };

/** Jumps to the funnel, optionally with a ride already chosen. */
export function openBooking(serviceId) {
  api.open(serviceId);
}

export function initBooking() {
  const section = $('[data-booking]');
  if (!section) return;

  const wizard = $('[data-wizard]', section);
  const layout = $('.book__layout', section);
  const form = $('[data-form]', section);
  const stepsNav = $('[data-steps]', section);
  const tabs = $$('[data-step-tab]', section);
  const steps = $$('[data-step]', section);
  const back = $('[data-back]', section);
  const next = $('[data-next]', section);
  const nextLabel = $('[data-next-label]', section);
  const nextIcon = $('use', next);
  const notice = $('[data-notice]', section);
  const slotsTitle = $('[data-slots-title]', section);
  const slotsList = $('[data-slots-list]', section);
  const guestsValue = $('[data-guests-value]', section);
  const guestsMinus = $('[data-guests-minus]', section);
  const guestsPlus = $('[data-guests-plus]', section);
  const namesRoot = $('[data-names]', section);
  const phone = $('#phone', section);
  const review = $('[data-review]', section);
  const total = $('[data-total]', section);
  const payNote = $('[data-pay-note]', section);
  const liveTicket = $('[data-ticket-live]', section);
  const done = $('[data-done]', section);
  const finalTicket = $('[data-ticket-final]', section);

  let state = blankState();
  let confirmed = null; // { booking, reference, preview } once a booking is complete
  let busy = false;

  /* ------------------------------------------------------------ storage -- */

  function save() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private mode: the funnel still works, it just will not survive a reload */
    }
  }

  function forget() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  /** Reads a saved draft back, keeping only what is still valid and bookable. */
  function restore() {
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      saved = null;
    }
    if (!saved || typeof saved !== 'object') return;

    const draft = blankState();
    if (typeof saved.serviceId === 'string' && Object.hasOwn(SERVICES, saved.serviceId)) draft.serviceId = saved.serviceId;
    if (parseISODate(saved.date) && bookableSlots(saved.date).length) {
      draft.date = saved.date;
      if (isSlotBookable(saved.date, saved.slotId)) draft.slotId = saved.slotId;
    }
    if (Number.isInteger(saved.guests) && saved.guests >= RULES.minGuests && saved.guests <= RULES.maxGuests) draft.guests = saved.guests;
    const names = Array.isArray(saved.names) ? saved.names.filter((name) => typeof name === 'string') : [];
    draft.names = Array.from({ length: draft.guests }, (_, i) => (names[i] || '').slice(0, RULES.maxNameLength));
    if (typeof saved.phone === 'string') draft.phone = saved.phone.slice(0, 32);
    state = draft;
    state.step = Math.min(Number.isInteger(saved.step) ? saved.step : 0, furthestStep());
  }

  /* --------------------------------------------------------- validation -- */

  const payload = () => ({
    serviceId: state.serviceId,
    date: state.date,
    slotId: state.slotId,
    guests: state.guests,
    names: state.names,
    phone: state.phone,
  });

  function errorsFor(step) {
    const errors = {};
    if (step === 0 && !state.serviceId) errors.serviceId = 'Choose a ride to continue.';
    if (step === 1) {
      if (!state.date) errors.date = 'Pick a date.';
      else if (!state.slotId) errors.slotId = 'Choose one of the start times.';
      else if (!isSlotBookable(state.date, state.slotId)) errors.slotId = 'That start time is no longer available. Please pick another.';
    }
    if (step === 2) {
      const missing = state.names.map(cleanName).findIndex((name) => !isValidName(name));
      if (missing !== -1) errors.names = state.guests === 1 ? 'Enter your full name.' : `Enter a name for each person. Person ${missing + 1} is missing.`;
      if (!normalizePhone(state.phone)) errors.phone = 'Enter a valid phone number. Outside the US, start with + and your country code.';
    }
    return errors;
  }

  const stepIsComplete = (step) => Object.keys(errorsFor(step)).length === 0;

  /** The furthest step the guest may open: everything before it must be complete. */
  function furthestStep() {
    for (let step = 0; step < LAST_STEP; step += 1) {
      if (!stepIsComplete(step)) return step;
    }
    return LAST_STEP;
  }

  const stepOfField = { serviceId: 0, date: 1, slotId: 1, guests: 2, names: 2, phone: 2, form: LAST_STEP };

  function clearErrors() {
    $$('[data-error]', section).forEach((node) => {
      node.textContent = '';
    });
    $$('[aria-invalid="true"]', section).forEach((node) => node.removeAttribute('aria-invalid'));
  }

  function showErrors(errors) {
    clearErrors();
    for (const [fieldName, message] of Object.entries(errors)) {
      const node = $(`[data-error="${fieldName}"]`, section);
      if (node) node.textContent = message;
    }
    if (errors.phone) phone.setAttribute('aria-invalid', 'true');
    if (errors.names) {
      $$('input', namesRoot).forEach((input, i) => {
        if (!isValidName(cleanName(state.names[i] || ''))) input.setAttribute('aria-invalid', 'true');
      });
    }
    // send the cursor to the first thing that needs fixing
    const first = $('[aria-invalid="true"]', section);
    if (first) first.focus();
  }

  /* ---------------------------------------------------------- rendering -- */

  function ticketData() {
    const service = SERVICES[state.serviceId];
    const slot = getSlot(state.slotId);
    return {
      serviceName: service?.name,
      dateLabel: state.date ? shortDate(state.date) : '',
      startLabel: slot ? formatTime(slot) : '',
      endLabel: slot ? formatTime(slotEnd(slot, service?.durationMinutes ?? 120)) : '',
      guests: state.guests,
      names: state.names.map(cleanName),
      totalLabel: formatMoney(totalCents(state.serviceId || 'wakesurf', state.guests)),
    };
  }

  function renderLiveTicket(shine = false) {
    if (!confirmed) renderTicket(liveTicket, ticketData(), { shine });
  }

  function renderTabs() {
    const furthest = furthestStep();
    tabs.forEach((tab, i) => {
      const item = tab.parentElement;
      item.classList.toggle('is-current', i === state.step);
      item.classList.toggle('is-done', i < state.step);
      tab.disabled = i > furthest;
      if (i === state.step) tab.setAttribute('aria-current', 'step');
      else tab.removeAttribute('aria-current');
    });
  }

  function renderNav() {
    back.hidden = state.step === 0;
    const paying = state.step === LAST_STEP;
    nextLabel.textContent = busy ? 'Opening secure checkout' : paying ? `Pay ${formatMoney(totalCents(state.serviceId, state.guests) ?? 0)}` : 'Continue';
    nextIcon.setAttribute('href', paying ? '#i-lock' : '#i-arrow');
    next.disabled = busy;
  }

  function renderSlots({ animate = false } = {}) {
    const open = state.date ? bookableSlots(state.date).map((slot) => slot.id) : [];
    const duration = SERVICES[state.serviceId]?.durationMinutes ?? 120;
    slotsTitle.textContent = state.date ? `${longDate(state.date).replace(/, \d{4}$/, '')}: choose a start time` : 'Pick a date to see start times';

    const cards = TIME_SLOTS.map((slot) => {
      const enabled = open.includes(slot.id);
      const [clock, meridiem] = formatTime(slot).split(' ');
      const caption = state.date && !enabled ? 'No longer available' : `Until ${formatTime(slotEnd(slot, duration))}`;
      const input = el('input', { type: 'radio', name: 'slot', value: slot.id, disabled: !enabled });
      input.checked = enabled && state.slotId === slot.id;
      return el(
        'label',
        { class: 'slot' },
        input,
        el(
          'span',
          { class: 'slot__card' },
          el('span', { class: 'slot__time' }, clock, el('small', {}, meridiem)),
          el('span', { class: 'slot__range' }, caption),
          el('span', { class: 'slot__dot', 'aria-hidden': 'true' }),
        ),
      );
    });
    slotsList.replaceChildren(...cards);
    if (animate && !reduceMotion) gsap.from(cards, { opacity: 0, y: 16, duration: 0.7, stagger: 0.09 });
  }

  function renderGuests() {
    guestsValue.textContent = String(state.guests);
    guestsMinus.disabled = state.guests <= RULES.minGuests;
    guestsPlus.disabled = state.guests >= RULES.maxGuests;
    $('[data-guests-hint]', section).textContent = `Up to ${RULES.maxGuests} people per session.`;
  }

  function renderNames({ animateLast = false } = {}) {
    state.names = Array.from({ length: state.guests }, (_, i) => state.names[i] ?? '');
    const rows = state.names.map((value, i) => {
      const input = el('input', {
        class: 'input',
        type: 'text',
        name: `name-${i + 1}`,
        placeholder: i === 0 ? 'Your full name' : 'Full name',
        autocomplete: i === 0 ? 'name' : 'off',
        autocapitalize: 'words',
        maxlength: String(RULES.maxNameLength),
        'aria-label': i === 0 ? 'Your full name (person 1)' : `Full name of person ${i + 1}`,
        dataset: { nameIndex: String(i) },
      });
      input.value = value;
      return el('label', { class: 'name' }, el('span', { 'aria-hidden': 'true' }, String(i + 1).padStart(2, '0')), input);
    });
    namesRoot.replaceChildren(...rows);
    if (animateLast && !reduceMotion) gsap.from(rows.at(-1), { opacity: 0, y: 12, duration: 0.5 });
  }

  function renderReview() {
    const result = validateBooking(payload());
    if (!result.ok) return;
    const { booking } = result;
    const row = (label, value, detail, step) =>
      el(
        'div',
        {},
        el('dt', {}, label),
        el('dd', {}, value, detail ? el('small', {}, detail) : null),
        el('button', { type: 'button', dataset: { edit: String(step) }, 'aria-label': `Edit ${label.toLowerCase()}` }, 'Edit'),
      );
    review.replaceChildren(
      row('Ride', booking.serviceName, 'Two-hour session', 0),
      row('When', shortDate(booking.date), `${booking.startLabel} to ${booking.endLabel}, Miami time`, 1),
      row('Crew', people(booking.guests), booking.names.join(', '), 2),
      row('Phone', booking.phoneDisplay, null, 2),
    );
    total.textContent = formatMoney(booking.totalCents);
    payNote.textContent =
      PAYMENTS === 'stripe'
        ? "You will pay on Stripe's secure checkout page, then come back here for your ticket."
        : 'Preview mode: online payment is not connected yet. Nothing is charged and this booking is not sent.';
  }

  /* --------------------------------------------------------- navigation -- */

  function goTo(step, { focus = true } = {}) {
    const target = Math.max(0, Math.min(step, furthestStep()));
    const direction = target >= state.step ? 1 : -1;
    const changed = target !== state.step;
    state.step = target;

    steps.forEach((fieldset, i) => {
      fieldset.hidden = i !== target;
    });
    if (target === 1) {
      calendar.render();
      renderSlots();
    }
    if (target === LAST_STEP) renderReview();
    renderTabs();
    renderNav();
    save();

    if (changed && !reduceMotion) {
      gsap.fromTo(steps[target], { opacity: 0, x: direction * 30 }, { opacity: 1, x: 0, duration: 0.65, ease: 'power3.out', clearProps: 'transform,opacity' });
    }
    if (focus) {
      steps[target].querySelector('.step__title')?.focus({ preventScroll: true });
      // keep the top of the form in view when a step is shorter or taller than the last
      if (wizard.getBoundingClientRect().top < 0) scrollToEl(wizard, { offset: -(($('[data-header]')?.offsetHeight || 0) + 16) });
    }
  }

  function setService(serviceId, { shine = true } = {}) {
    if (!Object.hasOwn(SERVICES, serviceId)) return;
    state.serviceId = serviceId;
    const radio = $(`input[name="service"][value="${serviceId}"]`, form);
    if (radio) radio.checked = true;
    clearErrors();
    renderLiveTicket(shine);
    renderTabs();
    renderNav();
    save();
  }

  /* --------------------------------------------------------- completion -- */

  function setBusy(value) {
    busy = value;
    renderNav();
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.hidden = !message;
  }

  function showConfirmation({ booking, reference, preview }) {
    confirmed = { booking, reference, preview };
    forget();
    form.hidden = true;
    stepsNav.hidden = true;
    showNotice('');
    layout.classList.add('is-done');
    done.hidden = false;

    const flag = $('[data-done-flag]', done);
    flag.hidden = !preview;
    flag.textContent = 'Preview mode. No payment was taken and this booking was not sent.';
    $('[data-done-text]', done).textContent = preview
      ? 'This is the confirmation your guests will see once online payment is connected.'
      : `Your session is booked. Keep this ticket: your booking reference is ${reference}.`;

    renderTicket(finalTicket, {
      serviceName: booking.serviceName,
      dateLabel: shortDate(booking.date),
      startLabel: booking.startLabel,
      endLabel: booking.endLabel,
      guests: booking.guests,
      names: booking.names,
      reference,
      totalLabel: formatMoney(booking.totalCents),
      stamp: preview ? 'Preview' : 'Paid',
    });

    if (!reduceMotion) {
      gsap
        .timeline()
        .from($('[data-done-title]', done), { opacity: 0, y: 26, duration: 0.9 }, 0)
        .from(finalTicket, { opacity: 0, y: 60, rotate: -5, scale: 0.92, duration: 1.3 }, 0.1)
        .add(() => finalTicket.classList.add('is-shining'), 0.7)
        .from($$('.done__text, .done__flag, .done__actions', done), { opacity: 0, y: 18, duration: 0.8, stagger: 0.08 }, 0.5);
    }
    $('[data-done-title]', done).focus({ preventScroll: true });
    scrollToEl(wizard, { offset: -(($('[data-header]')?.offsetHeight || 0) + 16) });
  }

  function restart() {
    confirmed = null;
    state = blankState();
    forget();
    form.reset();
    phone.value = '';
    done.hidden = true;
    form.hidden = false;
    stepsNav.hidden = false;
    layout.classList.remove('is-done');
    clearErrors();
    calendar.select(null, { notify: false });
    renderSlots();
    renderGuests();
    renderNames();
    renderLiveTicket();
    goTo(0);
  }

  function addToCalendar() {
    if (!confirmed) return;
    const { booking, reference, preview } = confirmed;
    const slot = getSlot(booking.slotId) || TIME_SLOTS.find((candidate) => formatTime(candidate) === booking.startLabel);
    const date = parseISODate(booking.date);
    if (!slot || !date) return;
    const start = businessTimeToUtc(date, slot);
    const end = new Date(start.getTime() + (booking.durationMinutes ?? 120) * 60_000);
    downloadIcs(
      `miami-aqua-experience-${reference}.ics`,
      buildIcs({
        uid: `${reference}@miami-aqua-experience`,
        title: `${booking.serviceName} - ${BUSINESS.name}${preview ? ' (preview)' : ''}`,
        start,
        end,
        location: BUSINESS.location,
        description: `Booking ${reference}. ${people(booking.guests)}: ${booking.names.join(', ')}.`,
      }),
    );
  }

  async function pay() {
    const result = validateBooking(payload());
    if (!result.ok) {
      // something changed under us (usually a start time that has since closed)
      const firstBad = Math.min(...Object.keys(result.errors).map((fieldName) => stepOfField[fieldName] ?? 0));
      goTo(firstBad);
      showErrors(result.errors);
      return;
    }

    if (PAYMENTS !== 'stripe') {
      showConfirmation({ booking: result.booking, reference: localReference(), preview: true });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && typeof data.url === 'string') {
        save(); // so the details are still here if the guest comes back
        window.location.assign(data.url);
        return;
      }
      if (response.status === 422 && data.fields) {
        const firstBad = Math.min(...Object.keys(data.fields).map((fieldName) => stepOfField[fieldName] ?? 0));
        goTo(firstBad);
        showErrors(data.fields);
      } else {
        showErrors({ form: 'We could not open the secure payment page, so nothing was charged. Please try again.' });
      }
    } catch {
      showErrors({ form: 'We could not reach the payment page, so nothing was charged. Check your connection and try again.' });
    }
    setBusy(false);
  }

  /** Coming back from Stripe: confirm with the server before showing a ticket. */
  async function handleReturn() {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('booking');
    if (!outcome) return;
    history.replaceState(null, '', `${window.location.pathname}#book`);

    if (outcome === 'cancelled') {
      goTo(LAST_STEP, { focus: false });
      showNotice('Payment was cancelled and nothing was charged. Your details are still here.');
      return;
    }
    if (outcome !== 'success') return;

    showNotice('Confirming your payment...');
    try {
      const response = await fetch(`/api/checkout?session_id=${encodeURIComponent(params.get('session_id') || '')}`);
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.paid && data.booking?.date) {
        showConfirmation({ booking: data.booking, reference: data.reference, preview: false });
        return;
      }
      showNotice('We could not confirm your payment yet. If you were charged, your booking is safe: check your email receipt before trying again.');
    } catch {
      showNotice('We could not check your payment just now. If you were charged, your booking is safe: check your email receipt before trying again.');
    }
  }

  /* -------------------------------------------------------------- events -- */

  const calendar = createCalendar($('[data-calendar]', section), {
    onSelect(date) {
      state.date = date;
      if (!isSlotBookable(date, state.slotId)) state.slotId = null;
      clearErrors();
      renderSlots({ animate: true });
      renderLiveTicket(true);
      renderTabs();
      save();
    },
  });

  form.addEventListener('change', (event) => {
    const { name, value } = event.target;
    if (name === 'service') setService(value);
    if (name === 'slot') {
      state.slotId = value;
      clearErrors();
      renderLiveTicket(true);
      renderTabs();
      save();
    }
  });

  form.addEventListener('input', (event) => {
    const input = event.target;
    if (input.dataset.nameIndex !== undefined) {
      state.names[Number(input.dataset.nameIndex)] = input.value;
      input.removeAttribute('aria-invalid');
    } else if (input === phone) {
      state.phone = phone.value;
      phone.removeAttribute('aria-invalid');
    } else {
      return;
    }
    renderLiveTicket();
    renderTabs();
    save();
  });

  // Tidy a valid US number into (305) 555-0123 when the guest leaves the field.
  phone.addEventListener('blur', () => {
    const parsed = normalizePhone(phone.value);
    if (parsed && !phone.value.trim().startsWith('+')) {
      phone.value = parsed.display;
      state.phone = parsed.display;
      save();
    }
  });

  const changeGuests = (delta) => {
    const nextCount = Math.max(RULES.minGuests, Math.min(RULES.maxGuests, state.guests + delta));
    if (nextCount === state.guests) return;
    state.guests = nextCount;
    renderGuests();
    renderNames({ animateLast: delta > 0 });
    clearErrors();
    renderLiveTicket(true);
    renderTabs();
    save();
  };
  guestsMinus.addEventListener('click', () => changeGuests(-1));
  guestsPlus.addEventListener('click', () => changeGuests(1));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    if (state.step === LAST_STEP) {
      pay();
      return;
    }
    const errors = errorsFor(state.step);
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    clearErrors();
    goTo(state.step + 1);
  });

  back.addEventListener('click', () => {
    clearErrors();
    goTo(state.step - 1);
  });

  tabs.forEach((tab, i) =>
    tab.addEventListener('click', () => {
      clearErrors();
      goTo(i);
    }),
  );

  review.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit]');
    if (edit) goTo(Number(edit.dataset.edit));
  });

  $('[data-ics]', section).addEventListener('click', addToCalendar);
  $('[data-restart]', section).addEventListener('click', restart);

  // A page restored from the back/forward cache must not stay stuck on "Opening...".
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && busy) setBusy(false);
  });

  /* ---------------------------------------------------------------- boot -- */

  restore();
  if (state.serviceId) {
    const radio = $(`input[name="service"][value="${state.serviceId}"]`, form);
    if (radio) radio.checked = true;
  }
  phone.value = state.phone;
  if (state.date) calendar.select(state.date, { notify: false });
  renderSlots();
  renderGuests();
  renderNames();
  renderLiveTicket();
  $('[data-secure-text]', section).textContent =
    PAYMENTS === 'stripe' ? 'Secure payment by Stripe' : 'Online payment switches on once Stripe is connected';
  goTo(state.step, { focus: false });

  api = {
    open(serviceId) {
      if (!confirmed && serviceId && Object.hasOwn(SERVICES, serviceId)) {
        setService(serviceId);
        if (state.step === 0) goTo(1, { focus: false });
      }
      scrollToEl($('.book__head', section), { offset: -(($('[data-header]')?.offsetHeight || 0) + 20) });
    },
  };

  handleReturn();
}

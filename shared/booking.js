// Single source of truth for what can be booked, what it costs and what a
// valid booking looks like. Imported by the page (src/) and by the payment
// endpoint (api/), so the price a guest sees is always the price charged.
//
// To change the offer, edit SERVICES / TIME_SLOTS / RULES below.

export const BUSINESS = {
  name: 'Miami Aqua Experience',
  location: 'Miami Beach, Florida',
  timeZone: 'America/New_York', // sessions are scheduled in Miami time
  currency: 'usd',
};

export const SERVICES = {
  wakesurf: { id: 'wakesurf', name: 'Wake Surfing', priceCents: 35000, durationMinutes: 120 },
  efoil: { id: 'efoil', name: 'E-Foil / E-Surf', priceCents: 35000, durationMinutes: 120 },
};

export const TIME_SLOTS = [
  { id: '0930', hour: 9, minute: 30 },
  { id: '1230', hour: 12, minute: 30 },
  { id: '1530', hour: 15, minute: 30 },
];

export const RULES = {
  minGuests: 1,
  maxGuests: 6,
  // 'per-session': one price covers the whole group for the 2 hours.
  // 'per-person':  price is multiplied by the number of people.
  pricing: 'per-session',
  // A start time can be booked until this many minutes before it begins.
  minLeadMinutes: 120,
  // How far ahead the calendar opens.
  maxAdvanceDays: 180,
  maxNameLength: 60,
};

/* ---------------------------------------------------------------- time -- */

const pad = (n) => String(n).padStart(2, '0');

/** "9:30 AM" for { hour: 9, minute: 30 } */
export function formatTime({ hour, minute }) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${pad(minute)} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function getSlot(slotId) {
  return TIME_SLOTS.find((s) => s.id === slotId) || null;
}

/** End time of a session that starts at `slot` and runs `durationMinutes`. */
export function slotEnd(slot, durationMinutes) {
  const total = slot.hour * 60 + slot.minute + durationMinutes;
  return { hour: Math.floor(total / 60) % 24, minute: total % 60 };
}

/** Strictly parses "YYYY-MM-DD" into { y, m, d }, or null if it is not a real date. */
export function parseISODate(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

export function toISODate({ y, m, d }) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Whole days since the epoch for a calendar date (no time zone involved). */
function dayNumber({ y, m, d }) {
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** Offset (local minus UTC, in minutes) of `timeZone` at the instant `utcMs`. */
function offsetMinutes(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** The wall-clock date and time in the business time zone at `now`. */
export function businessNow(now = new Date(), timeZone = BUSINESS.timeZone) {
  const local = new Date(now.getTime() + offsetMinutes(now.getTime(), timeZone) * 60000);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth() + 1,
    d: local.getUTCDate(),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** The UTC instant of a wall-clock time in the business time zone. */
export function businessTimeToUtc({ y, m, d }, { hour, minute }, timeZone = BUSINESS.timeZone) {
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const first = guess - offsetMinutes(guess, timeZone) * 60000;
  // Re-check with the offset that applies at the corrected instant (DST edges).
  return new Date(guess - offsetMinutes(first, timeZone) * 60000);
}

/* -------------------------------------------------------- availability -- */

/**
 * Can this start time still be booked? True when it is at least
 * RULES.minLeadMinutes away (Miami time) and inside the booking window.
 */
export function isSlotBookable(dateISO, slotId, now = new Date()) {
  const date = parseISODate(dateISO);
  const slot = getSlot(slotId);
  if (!date || !slot) return false;
  const today = businessNow(now);
  const daysAhead = dayNumber(date) - dayNumber(today);
  if (daysAhead < 0 || daysAhead > RULES.maxAdvanceDays) return false;
  const minutesUntilStart = daysAhead * 1440 + slot.hour * 60 + slot.minute - today.minutes;
  return minutesUntilStart >= RULES.minLeadMinutes;
}

/** The start times that can still be booked on a date. */
export function bookableSlots(dateISO, now = new Date()) {
  return TIME_SLOTS.filter((slot) => isSlotBookable(dateISO, slot.id, now));
}

export function isDateBookable(dateISO, now = new Date()) {
  return bookableSlots(dateISO, now).length > 0;
}

/* -------------------------------------------------------------- price -- */

export function totalCents(serviceId, guests) {
  const service = SERVICES[serviceId];
  if (!service) return null;
  return RULES.pricing === 'per-person' ? service.priceCents * guests : service.priceCents;
}

export function formatMoney(cents) {
  const dollars = cents / 100;
  return `$${Number.isInteger(dollars) ? dollars.toLocaleString('en-US') : dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* --------------------------------------------------------- validation -- */

/**
 * Accepts US numbers ("305 555 0123", "(305) 555-0123", "1-305-555-0123") and
 * international numbers written with a leading "+". Returns the number in
 * E.164 form plus a friendly display form, or null when it cannot be a phone
 * number.
 */
export function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    if (digits.length < 8 || digits.length > 15) return null;
    return { e164: `+${digits}`, display: `+${digits}` };
  }
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  // US numbers: 10 digits, area code and exchange never start with 0 or 1.
  if (national.length !== 10 || /^[01]/.test(national) || /^[01]/.test(national.slice(3))) return null;
  return {
    e164: `+1${national}`,
    display: `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`,
  };
}

export function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  // Collapse whitespace and drop control characters.
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

export function isValidName(name) {
  return name.length >= 2 && name.length <= RULES.maxNameLength && /\p{L}/u.test(name);
}

/**
 * Checks a booking request. Returns { ok: true, booking } with a normalised
 * booking, or { ok: false, errors } where errors maps a field to a message
 * that can be shown to the guest.
 *
 * input: { serviceId, date: "YYYY-MM-DD", slotId, guests, names: string[], phone }
 */
export function validateBooking(input, now = new Date()) {
  const errors = {};
  const data = input && typeof input === 'object' ? input : {};

  const service = typeof data.serviceId === 'string' && Object.hasOwn(SERVICES, data.serviceId) ? SERVICES[data.serviceId] : null;
  if (!service) errors.serviceId = 'Choose a ride.';

  const date = parseISODate(data.date);
  const slot = typeof data.slotId === 'string' ? getSlot(data.slotId) : null;
  if (!date) errors.date = 'Choose a date.';
  if (!slot) errors.slotId = 'Choose a start time.';
  if (date && slot && !isSlotBookable(data.date, slot.id, now)) {
    errors.slotId = 'That start time is no longer available. Please pick another.';
  }

  const guests = data.guests;
  const guestsValid = Number.isInteger(guests) && guests >= RULES.minGuests && guests <= RULES.maxGuests;
  if (!guestsValid) errors.guests = `Choose between ${RULES.minGuests} and ${RULES.maxGuests} people.`;

  const names = Array.isArray(data.names) ? data.names.map(cleanName) : [];
  if (guestsValid) {
    if (names.length !== guests) {
      errors.names = 'Add a name for each person.';
    } else if (!names.every(isValidName)) {
      errors.names = 'Add a name for each person.';
    }
  }

  const phone = normalizePhone(data.phone);
  if (!phone) errors.phone = 'Enter a valid phone number. Outside the US, start with + and your country code.';

  if (Object.keys(errors).length) return { ok: false, errors };

  const end = slotEnd(slot, service.durationMinutes);
  return {
    ok: true,
    booking: {
      serviceId: service.id,
      serviceName: service.name,
      date: toISODate(date),
      slotId: slot.id,
      startLabel: formatTime(slot),
      endLabel: formatTime(end),
      durationMinutes: service.durationMinutes,
      guests,
      names,
      phone: phone.e164,
      phoneDisplay: phone.display,
      totalCents: totalCents(service.id, guests),
      currency: BUSINESS.currency,
    },
  };
}

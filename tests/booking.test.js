import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RULES,
  SERVICES,
  TIME_SLOTS,
  bookableSlots,
  businessNow,
  businessTimeToUtc,
  formatMoney,
  formatTime,
  isDateBookable,
  isSlotBookable,
  normalizePhone,
  parseISODate,
  slotEnd,
  totalCents,
  validateBooking,
} from '../shared/booking.js';

// Fri 20 Nov 2026, 11:12 AM in Miami (EST, UTC-5).
const NOW = new Date('2026-11-20T16:12:00Z');

const valid = (overrides = {}) => ({
  serviceId: 'wakesurf',
  date: '2026-12-05',
  slotId: '0930',
  guests: 2,
  names: ['Ana Lopez', 'Sam Reed'],
  phone: '(305) 555-0123',
  ...overrides,
});

test('the offer matches the brief: two rides at $350 for two hours, three start times', () => {
  assert.deepEqual(Object.keys(SERVICES), ['wakesurf', 'efoil']);
  for (const service of Object.values(SERVICES)) {
    assert.equal(service.priceCents, 35000);
    assert.equal(service.durationMinutes, 120);
  }
  assert.deepEqual(TIME_SLOTS.map(formatTime), ['9:30 AM', '12:30 PM', '3:30 PM']);
});

test('formatTime and slotEnd', () => {
  assert.equal(formatTime({ hour: 0, minute: 5 }), '12:05 AM');
  assert.equal(formatTime({ hour: 12, minute: 0 }), '12:00 PM');
  assert.equal(formatTime(slotEnd({ hour: 9, minute: 30 }, 120)), '11:30 AM');
  assert.equal(formatTime(slotEnd({ hour: 15, minute: 30 }, 120)), '5:30 PM');
});

test('parseISODate accepts only real calendar dates', () => {
  assert.deepEqual(parseISODate('2026-12-05'), { y: 2026, m: 12, d: 5 });
  assert.deepEqual(parseISODate('2028-02-29'), { y: 2028, m: 2, d: 29 });
  for (const bad of ['2026-02-30', '2026-13-01', '2026-1-5', '12/05/2026', '', null, 20261205]) {
    assert.equal(parseISODate(bad), null, String(bad));
  }
});

test('businessNow reads the clock in Miami, in winter and summer time', () => {
  assert.deepEqual(businessNow(NOW), { y: 2026, m: 11, d: 20, minutes: 11 * 60 + 12 });
  // 03:30 UTC on 1 July is 11:30 PM on 30 June in Miami (EDT, UTC-4).
  assert.deepEqual(businessNow(new Date('2026-07-01T03:30:00Z')), { y: 2026, m: 6, d: 30, minutes: 23 * 60 + 30 });
});

test('businessTimeToUtc converts Miami wall-clock time, in winter and summer time', () => {
  assert.equal(businessTimeToUtc({ y: 2026, m: 12, d: 5 }, { hour: 9, minute: 30 }).toISOString(), '2026-12-05T14:30:00.000Z');
  assert.equal(businessTimeToUtc({ y: 2026, m: 7, d: 4 }, { hour: 15, minute: 30 }).toISOString(), '2026-07-04T19:30:00.000Z');
});

test('start times close once they are less than the lead time away', () => {
  assert.equal(RULES.minLeadMinutes, 120);
  // 11:12 AM in Miami: 9:30 has passed, 12:30 is 78 minutes away, 3:30 is fine.
  assert.equal(isSlotBookable('2026-11-20', '0930', NOW), false);
  assert.equal(isSlotBookable('2026-11-20', '1230', NOW), false);
  assert.equal(isSlotBookable('2026-11-20', '1530', NOW), true);
  assert.deepEqual(bookableSlots('2026-11-20', NOW).map((s) => s.id), ['1530']);
  assert.deepEqual(bookableSlots('2026-11-21', NOW).map((s) => s.id), ['0930', '1230', '1530']);
});

test('exactly at the lead time is still bookable, one minute later is not', () => {
  assert.equal(isSlotBookable('2026-11-20', '1530', new Date('2026-11-20T18:30:00Z')), true); // 1:30 PM
  assert.equal(isSlotBookable('2026-11-20', '1530', new Date('2026-11-20T18:31:00Z')), false); // 1:31 PM
});

test('"today" follows Miami, not UTC or the visitor', () => {
  // 10 PM on 20 Nov in Miami is already 21 Nov in UTC.
  const lateEvening = new Date('2026-11-21T03:00:00Z');
  assert.equal(isDateBookable('2026-11-20', lateEvening), false);
  assert.equal(isSlotBookable('2026-11-21', '0930', lateEvening), true);
});

test('past dates and dates beyond the booking window are closed', () => {
  assert.equal(isDateBookable('2026-11-19', NOW), false);
  assert.equal(isDateBookable('2027-05-19', NOW), true); // 180 days ahead
  assert.equal(isDateBookable('2027-05-20', NOW), false); // 181 days ahead
  assert.equal(isSlotBookable('2026-11-21', '0800', NOW), false); // not a start time we offer
  assert.equal(isSlotBookable('not-a-date', '0930', NOW), false);
});

test('price is per session, whatever the group size', () => {
  assert.equal(RULES.pricing, 'per-session');
  assert.equal(totalCents('wakesurf', 1), 35000);
  assert.equal(totalCents('efoil', 6), 35000);
  assert.equal(totalCents('jetski', 2), null);
  assert.equal(formatMoney(35000), '$350');
  assert.equal(formatMoney(35050), '$350.50');
  assert.equal(formatMoney(210000), '$2,100');
});

test('normalizePhone accepts US and +international numbers', () => {
  const us = { e164: '+13055550123', display: '(305) 555-0123' };
  for (const input of ['3055550123', '(305) 555-0123', '305-555-0123', '305.555.0123', '1 305 555 0123', ' 305 555 0123 ']) {
    assert.deepEqual(normalizePhone(input), us, input);
  }
  assert.deepEqual(normalizePhone('+1 (305) 555-0123'), { e164: '+13055550123', display: '+13055550123' });
  assert.deepEqual(normalizePhone('+57 300 123 4567'), { e164: '+573001234567', display: '+573001234567' });
});

test('normalizePhone rejects things that cannot be a phone number', () => {
  for (const input of ['', '555-0123', '12345', '305 555 0123 ext 4', 'call me', '123 456 7890', '305 155 0123', '+123', '+1234567890123456', null, 3055550123]) {
    assert.equal(normalizePhone(input), null, String(input));
  }
});

test('validateBooking returns a normalised booking', () => {
  const result = validateBooking(valid({ names: ['  Ana   Lopez ', 'Sam Reed'] }), NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.booking, {
    serviceId: 'wakesurf',
    serviceName: 'Wake Surfing',
    date: '2026-12-05',
    slotId: '0930',
    startLabel: '9:30 AM',
    endLabel: '11:30 AM',
    durationMinutes: 120,
    guests: 2,
    names: ['Ana Lopez', 'Sam Reed'],
    phone: '+13055550123',
    phoneDisplay: '(305) 555-0123',
    totalCents: 35000,
    currency: 'usd',
  });
});

test('validateBooking reports every problem by field', () => {
  const result = validateBooking({ serviceId: 'jetski', date: '2026-02-30', slotId: '0800', guests: 0, names: [], phone: 'nope' }, NOW);
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ['date', 'guests', 'phone', 'serviceId', 'slotId']);
});

test('validateBooking needs one real name per person', () => {
  assert.equal(validateBooking(valid({ guests: 3 }), NOW).errors.names, 'Add a name for each person.');
  assert.equal(validateBooking(valid({ names: ['Ana Lopez', ' '] }), NOW).errors.names, 'Add a name for each person.');
  assert.equal(validateBooking(valid({ names: ['Ana Lopez', '12345'] }), NOW).errors.names, 'Add a name for each person.');
  assert.equal(validateBooking(valid({ names: ['Ana Lopez', 'x'.repeat(61)] }), NOW).errors.names, 'Add a name for each person.');
  assert.equal(validateBooking(valid({ names: ['José Núñez', "Zoë O'Neil-Smith"] }), NOW).ok, true);
});

test('validateBooking enforces the group size limits', () => {
  assert.equal(validateBooking(valid({ guests: 7, names: Array(7).fill('Ana Lopez') }), NOW).ok, false);
  assert.equal(validateBooking(valid({ guests: 6, names: Array(6).fill('Ana Lopez') }), NOW).ok, true);
  assert.equal(validateBooking(valid({ guests: 2.5 }), NOW).ok, false);
  assert.equal(validateBooking(valid({ guests: '2' }), NOW).ok, false);
});

test('validateBooking rejects a start time that has closed', () => {
  const result = validateBooking(valid({ date: '2026-11-20', slotId: '1230' }), NOW);
  assert.equal(result.ok, false);
  assert.match(result.errors.slotId, /no longer available/);
});

test('validateBooking is not fooled by inherited property names or junk input', () => {
  for (const serviceId of ['__proto__', 'constructor', 'toString', '', null, 42]) {
    assert.equal(validateBooking(valid({ serviceId }), NOW).ok, false, String(serviceId));
  }
  for (const junk of [null, undefined, 'string', 42, []]) {
    assert.equal(validateBooking(junk, NOW).ok, false);
  }
});

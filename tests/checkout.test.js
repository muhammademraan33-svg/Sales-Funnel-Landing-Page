import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import handler, { buildSessionParams, createCheckout, newReference, readCheckout, resolveSiteUrl } from '../api/checkout.js';
import { validateBooking } from '../shared/booking.js';

const NOW = new Date('2026-11-20T16:12:00Z'); // 11:12 AM in Miami
const SITE = 'https://example.test';
const KEY = 'sk_test_not_a_real_key';

const input = (overrides = {}) => ({
  serviceId: 'efoil',
  date: '2026-12-05',
  slotId: '1530',
  guests: 3,
  names: ['Ana Lopez', 'Sam Reed', 'José Núñez'],
  phone: '+57 300 123 4567',
  ...overrides,
});

/** A stand-in for fetch that records the request and answers like Stripe. */
function fakeStripe(reply = { status: 200, json: { id: 'cs_test_abc', url: 'https://checkout.stripe.com/c/pay/cs_test_abc' } }) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, ...options });
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.json };
  };
  return { calls, fetchImpl };
}

test('references are short, unambiguous and vary', () => {
  const refs = new Set(Array.from({ length: 200 }, newReference));
  assert.ok(refs.size > 190);
  for (const ref of refs) assert.match(ref, /^MAE-[A-HJKMNP-Z2-9]{6}$/);
});

test('the Stripe session carries the server-side price and the full booking', () => {
  const { booking } = validateBooking(input(), NOW);
  const params = buildSessionParams(booking, { siteUrl: SITE, reference: 'MAE-TEST22' });
  const get = (key) => params.get(key);

  assert.equal(get('mode'), 'payment');
  assert.equal(get('submit_type'), 'book');
  assert.equal(get('client_reference_id'), 'MAE-TEST22');
  assert.equal(get('line_items[0][quantity]'), '1');
  assert.equal(get('line_items[0][price_data][currency]'), 'usd');
  assert.equal(get('line_items[0][price_data][unit_amount]'), '35000');
  assert.equal(get('line_items[0][price_data][product_data][name]'), 'E-Foil / E-Surf - 2-hour session');
  assert.equal(get('line_items[0][price_data][product_data][description]'), 'Sat, Dec 5, 2026, 3:30 PM - 5:30 PM (Miami time) | 3 people');
  assert.equal(get('success_url'), `${SITE}/?booking=success&session_id={CHECKOUT_SESSION_ID}#book`);
  assert.equal(get('cancel_url'), `${SITE}/?booking=cancelled#book`);

  for (const prefix of ['metadata', 'payment_intent_data[metadata]']) {
    assert.equal(get(`${prefix}[reference]`), 'MAE-TEST22');
    assert.equal(get(`${prefix}[service]`), 'E-Foil / E-Surf');
    assert.equal(get(`${prefix}[date]`), '2026-12-05');
    assert.equal(get(`${prefix}[start]`), '3:30 PM');
    assert.equal(get(`${prefix}[guests]`), '3');
    assert.equal(get(`${prefix}[phone]`), '+573001234567');
    assert.equal(get(`${prefix}[rider_1]`), 'Ana Lopez');
    assert.equal(get(`${prefix}[rider_3]`), 'José Núñez');
    assert.equal(get(`${prefix}[rider_4]`), null);
  }
});

test('createCheckout posts to Stripe with the secret key and returns the pay link', async () => {
  const stripe = fakeStripe();
  const result = await createCheckout(input(), { secretKey: KEY, siteUrl: SITE, now: NOW, fetchImpl: stripe.fetchImpl });

  assert.equal(result.status, 200);
  assert.equal(result.body.url, 'https://checkout.stripe.com/c/pay/cs_test_abc');
  assert.match(result.body.reference, /^MAE-/);

  assert.equal(stripe.calls.length, 1);
  const [call] = stripe.calls;
  assert.equal(call.url, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(call.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(new URLSearchParams(call.body).get('line_items[0][price_data][unit_amount]'), '35000');
});

test('a price or total sent by the browser is ignored', async () => {
  const stripe = fakeStripe();
  await createCheckout(input({ totalCents: 100, priceCents: 1, price: 1 }), { secretKey: KEY, siteUrl: SITE, now: NOW, fetchImpl: stripe.fetchImpl });
  assert.equal(new URLSearchParams(stripe.calls[0].body).get('line_items[0][price_data][unit_amount]'), '35000');
});

test('without a Stripe key nothing is sent and the endpoint says so', async () => {
  const stripe = fakeStripe();
  const result = await createCheckout(input(), { secretKey: undefined, siteUrl: SITE, now: NOW, fetchImpl: stripe.fetchImpl });
  assert.deepEqual(result, { status: 503, body: { error: 'payments_not_configured' } });
  assert.equal(stripe.calls.length, 0);
});

test('an invalid booking never reaches Stripe', async () => {
  const stripe = fakeStripe();
  const result = await createCheckout(input({ date: '2026-11-19', guests: 9 }), { secretKey: KEY, siteUrl: SITE, now: NOW, fetchImpl: stripe.fetchImpl });
  assert.equal(result.status, 422);
  assert.equal(result.body.error, 'invalid_booking');
  assert.deepEqual(Object.keys(result.body.fields).sort(), ['guests', 'slotId']);
  assert.equal(stripe.calls.length, 0);
});

test('Stripe errors and network failures surface as 502, never as success', async () => {
  const declined = fakeStripe({ status: 401, json: { error: { message: 'Invalid API Key provided' } } });
  const a = await createCheckout(input(), { secretKey: KEY, siteUrl: SITE, now: NOW, fetchImpl: declined.fetchImpl });
  assert.deepEqual(a, { status: 502, body: { error: 'payment_provider_error' } });

  const offline = async () => {
    throw new Error('getaddrinfo ENOTFOUND api.stripe.com');
  };
  const b = await createCheckout(input(), { secretKey: KEY, siteUrl: SITE, now: NOW, fetchImpl: offline });
  assert.deepEqual(b, { status: 502, body: { error: 'payment_provider_unreachable' } });
});

test('readCheckout reports paid only when Stripe says the session is paid', async () => {
  const session = (payment_status) => ({
    status: 200,
    json: {
      id: 'cs_test_abcdefghij',
      payment_status,
      amount_total: 35000,
      metadata: { reference: 'MAE-TEST22', service: 'Wake Surfing', date: '2026-12-05', start: '9:30 AM', end: '11:30 AM', guests: '2', rider_1: 'Ana Lopez', rider_2: 'Sam Reed' },
    },
  });

  const paid = await readCheckout('cs_test_abcdefghij', { secretKey: KEY, fetchImpl: fakeStripe(session('paid')).fetchImpl });
  assert.equal(paid.status, 200);
  assert.deepEqual(paid.body, {
    paid: true,
    reference: 'MAE-TEST22',
    booking: { serviceName: 'Wake Surfing', date: '2026-12-05', startLabel: '9:30 AM', endLabel: '11:30 AM', guests: 2, names: ['Ana Lopez', 'Sam Reed'], totalCents: 35000 },
  });

  const unpaid = await readCheckout('cs_test_abcdefghij', { secretKey: KEY, fetchImpl: fakeStripe(session('unpaid')).fetchImpl });
  assert.equal(unpaid.body.paid, false);
});

test('readCheckout rejects malformed ids without calling Stripe', async () => {
  const stripe = fakeStripe();
  for (const id of [null, '', 'abc', 'cs_test_', 'cs_test_abc/../../charges', 'pi_123456789012']) {
    const result = await readCheckout(id, { secretKey: KEY, fetchImpl: stripe.fetchImpl });
    assert.equal(result.status, 400, String(id));
  }
  assert.equal(stripe.calls.length, 0);
});

test('resolveSiteUrl prefers SITE_URL and otherwise trusts only a clean host header', () => {
  assert.equal(resolveSiteUrl({ headers: { host: 'evil.test' } }, { SITE_URL: 'https://miamiaquaexperience.com/' }), 'https://miamiaquaexperience.com');
  assert.equal(resolveSiteUrl({ headers: { host: 'mae.vercel.app', 'x-forwarded-proto': 'https' } }, {}), 'https://mae.vercel.app');
  assert.equal(resolveSiteUrl({ headers: { host: 'localhost:5173' } }, {}), 'http://localhost:5173');
  assert.equal(resolveSiteUrl({ headers: { host: 'bad host/<script>' } }, {}), null);
  assert.equal(resolveSiteUrl({ headers: {} }, {}), null);
});

/* ---- the HTTP handler itself ---- */

function request({ method = 'POST', url = '/api/checkout', body, headers = { host: 'localhost:5173' } } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)]);
  Object.assign(req, { method, url, headers });
  return req;
}

function response() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };
  res.end = (chunk = '') => {
    res.body = chunk;
  };
  return res;
}

test('handler: with no key configured, POST answers 503 and takes no payment', async () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try {
    const res = response();
    await handler(request({ body: JSON.stringify(input()) }), res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(JSON.parse(res.body), { error: 'payments_not_configured' });
    assert.equal(res.headers['cache-control'], 'no-store');
  } finally {
    if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
  }
});

test('handler: bad JSON, oversized bodies and other methods are refused', async () => {
  const bad = response();
  await handler(request({ body: '{not json' }), bad);
  assert.equal(bad.statusCode, 400);

  const huge = response();
  await handler(request({ body: JSON.stringify({ names: ['x'.repeat(20_000)] }) }), huge);
  assert.equal(huge.statusCode, 400);

  const del = response();
  await handler(request({ method: 'DELETE' }), del);
  assert.equal(del.statusCode, 405);
  assert.equal(del.headers.allow, 'GET, POST');
});

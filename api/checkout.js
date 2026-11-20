// Payment hand-off for the booking funnel (Vercel Serverless Function).
//
//   POST /api/checkout                  -> validates the booking, creates a Stripe
//                                          Checkout Session, returns { url }
//   GET  /api/checkout?session_id=cs_.. -> confirms whether that session was paid
//
// Needs STRIPE_SECRET_KEY in the environment. Without it the endpoint answers
// 503 and takes no payment. The amount is always computed here from
// shared/booking.js; a price sent by the browser is never trusted.

import { randomInt } from 'node:crypto';
import { BUSINESS, RULES, validateBooking } from '../shared/booking.js';

const STRIPE_API = 'https://api.stripe.com/v1';
const MAX_BODY_BYTES = 10_000;
const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I/L)

export function newReference() {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `MAE-${code}`;
}

/** "Sat, Dec 5, 2026" for "2026-12-05" */
export function formatDateLong(dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The form-encoded body Stripe expects for a one-off booking payment. */
export function buildSessionParams(booking, { siteUrl, reference }) {
  const people = `${booking.guests} ${booking.guests === 1 ? 'person' : 'people'}`;
  const when = `${formatDateLong(booking.date)}, ${booking.startLabel} - ${booking.endLabel} (Miami time)`;
  const summary = `${booking.serviceName} | ${when} | ${people}`;
  const perPerson = RULES.pricing === 'per-person';

  // Everything the business needs to run the session travels with the payment,
  // so it shows up next to the charge in the Stripe dashboard.
  const metadata = {
    reference,
    service: booking.serviceName,
    date: booking.date,
    start: booking.startLabel,
    end: booking.endLabel,
    guests: String(booking.guests),
    phone: booking.phone,
  };
  booking.names.forEach((name, i) => {
    metadata[`rider_${i + 1}`] = name;
  });

  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('submit_type', 'book');
  params.set('client_reference_id', reference);
  params.set('success_url', `${siteUrl}/?booking=success&session_id={CHECKOUT_SESSION_ID}#book`);
  params.set('cancel_url', `${siteUrl}/?booking=cancelled#book`);
  params.set('line_items[0][quantity]', String(perPerson ? booking.guests : 1));
  params.set('line_items[0][price_data][currency]', booking.currency);
  params.set('line_items[0][price_data][unit_amount]', String(perPerson ? booking.totalCents / booking.guests : booking.totalCents));
  params.set('line_items[0][price_data][product_data][name]', `${booking.serviceName} - 2-hour session`);
  params.set('line_items[0][price_data][product_data][description]', `${when} | ${people}`);
  params.set('payment_intent_data[description]', `${BUSINESS.name}: ${summary} (${reference})`);
  for (const [key, value] of Object.entries(metadata)) {
    params.set(`metadata[${key}]`, value);
    params.set(`payment_intent_data[metadata][${key}]`, value);
  }
  return params;
}

/**
 * Validates the booking and opens a Stripe Checkout Session for it.
 * Returns { status, body } so it can be tested without a server.
 */
export async function createCheckout(input, { secretKey, siteUrl, now = new Date(), fetchImpl = fetch } = {}) {
  if (!secretKey) return { status: 503, body: { error: 'payments_not_configured' } };

  const result = validateBooking(input, now);
  if (!result.ok) return { status: 422, body: { error: 'invalid_booking', fields: result.errors } };

  const reference = newReference();
  let response;
  let session;
  try {
    response = await fetchImpl(`${STRIPE_API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: buildSessionParams(result.booking, { siteUrl, reference }).toString(),
    });
    session = await response.json();
  } catch (error) {
    console.error('Stripe request failed:', error.message);
    return { status: 502, body: { error: 'payment_provider_unreachable' } };
  }

  if (!response.ok || !session?.url) {
    console.error('Stripe rejected the session:', session?.error?.message || response.status);
    return { status: 502, body: { error: 'payment_provider_error' } };
  }
  return { status: 200, body: { url: session.url, reference } };
}

/** Confirms with Stripe whether a Checkout Session has actually been paid. */
export async function readCheckout(sessionId, { secretKey, fetchImpl = fetch } = {}) {
  if (!secretKey) return { status: 503, body: { error: 'payments_not_configured' } };
  if (typeof sessionId !== 'string' || !/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) {
    return { status: 400, body: { error: 'invalid_session' } };
  }

  let response;
  let session;
  try {
    response = await fetchImpl(`${STRIPE_API}/checkout/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    session = await response.json();
  } catch (error) {
    console.error('Stripe request failed:', error.message);
    return { status: 502, body: { error: 'payment_provider_unreachable' } };
  }
  if (response.status === 404) return { status: 404, body: { error: 'session_not_found' } };
  if (!response.ok) {
    console.error('Stripe could not return the session:', session?.error?.message || response.status);
    return { status: 502, body: { error: 'payment_provider_error' } };
  }

  const meta = session.metadata || {};
  const names = [];
  for (let i = 1; meta[`rider_${i}`]; i += 1) names.push(meta[`rider_${i}`]);
  return {
    status: 200,
    body: {
      paid: session.payment_status === 'paid',
      reference: meta.reference || null,
      booking: {
        serviceName: meta.service || null,
        date: meta.date || null,
        startLabel: meta.start || null,
        endLabel: meta.end || null,
        guests: Number(meta.guests) || null,
        names,
        totalCents: session.amount_total ?? null,
      },
    },
  };
}

/** Where Stripe should send the guest back to. Prefer SITE_URL when set. */
export function resolveSiteUrl(req, env = process.env) {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return null;
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host);
  const proto = forwarded === 'http' || forwarded === 'https' ? forwarded : local ? 'http' : 'https';
  return `${proto}://${host}`;
}

async function readJsonBody(req) {
  let parsed;
  try {
    parsed = req.body; // Vercel parses JSON bodies lazily and throws on bad JSON
  } catch {
    return null;
  }
  if (parsed && typeof parsed === 'object') return parsed;

  let raw = typeof parsed === 'string' ? parsed : '';
  if (!raw) {
    req.setEncoding('utf8');
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) return null;
    }
  }
  if (raw.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (req.method === 'POST') {
    const input = await readJsonBody(req);
    if (!input) return send(res, 400, { error: 'invalid_request' });
    const siteUrl = resolveSiteUrl(req);
    if (!siteUrl) return send(res, 400, { error: 'invalid_request' });
    const { status, body } = await createCheckout(input, { secretKey, siteUrl });
    return send(res, status, body);
  }

  if (req.method === 'GET') {
    const sessionId = new URL(req.url, 'http://localhost').searchParams.get('session_id');
    const { status, body } = await readCheckout(sessionId, { secretKey });
    return send(res, status, body);
  }

  res.setHeader('Allow', 'GET, POST');
  return send(res, 405, { error: 'method_not_allowed' });
}

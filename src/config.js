// How the last step of the booking funnel behaves.
//
//   'preview' (default)  The whole funnel works, but no payment is taken and
//                        nothing is sent anywhere. The confirmation says so.
//   'stripe'             "Pay" opens Stripe's hosted checkout through
//                        /api/checkout and only a paid session is confirmed.
//
// To go live, set VITE_PAYMENTS=stripe and STRIPE_SECRET_KEY in the Vercel
// project settings and redeploy. See README.md.
export const PAYMENTS = import.meta.env.VITE_PAYMENTS === 'stripe' ? 'stripe' : 'preview';

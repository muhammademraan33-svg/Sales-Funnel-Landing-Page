import { defineConfig, loadEnv } from 'vite';

// Serves api/checkout.js locally the way Vercel serves it in production, so
// `npm run dev` and `npm run preview` exercise the real payment endpoint.
function localApi() {
  const mount = (server) => {
    server.middlewares.use('/api/checkout', async (req, res) => {
      try {
        const { default: handler } = await import('./api/checkout.js');
        await handler(req, res);
      } catch (error) {
        console.error(error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'server_error' }));
      }
    });
  };
  return { name: 'local-api', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig(({ mode }) => {
  // Make STRIPE_SECRET_KEY / SITE_URL from .env.local visible to the local endpoint.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['STRIPE_SECRET_KEY', 'SITE_URL']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

  return {
    plugins: [localApi()],
    build: {
      target: 'es2022',
      assetsInlineLimit: 0,
    },
  };
});

import { defineConfig, loadEnv, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Serve the Vercel functions in api/ during `npm run dev`, so /api/shorten and
 * /api/bridge work locally. The key comes from .env.local and stays on the server:
 * only VITE_-prefixed variables are ever exposed to the browser bundle.
 */
function devApi(): Plugin {
  const routes: Record<string, string> = { '/api/shorten': '/api/shorten.ts', '/api/bridge': '/api/bridge.ts' };
  return {
    name: 'keep-the-point-dev-api',
    apply: 'serve',
    config(_, { mode }) {
      const env = loadEnv(mode, process.cwd(), 'GEMINI_');
      for (const [k, v] of Object.entries(env)) process.env[k] ??= v;
    },
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const path = (req.url ?? '').split('?')[0];
        const file = routes[path];
        if (!file) return next();
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = Buffer.concat(chunks).toString('utf8');
          const request = new Request(`http://localhost${path}`, {
            method: req.method,
            headers: { 'content-type': String(req.headers['content-type'] ?? 'application/json') },
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
          });
          const mod = (await server.ssrLoadModule(file)) as { POST: (r: Request) => Promise<Response> };
          const response = await mod.POST(request);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(await response.text());
        } catch {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'Something went wrong on the dev server.' }));
        }
      });
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [devApi()],
  // Inline (empty) PostCSS config so Vite doesn't pick up a config from a parent folder.
  css: { postcss: {} },
});

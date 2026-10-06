/*
 * Server API that lets the browser race OpenRouter decision models without seeing the key.
 *
 * `decisionApi` is a Vite plugin that mounts the same middleware on the dev server and on the
 * preview server used in production. It serves three routes. `GET /api/decision-models`
 * lists every OpenRouter model whose output modality is "decisions" as `{ id, name, promptPrice }`
 * (name without the provider prefix, price in dollars per million prompt tokens).
 * `GET /api/key-status` answers `{ state, message, remaining }` from `checkKey`: "invalid" when
 * OpenRouter rejects the key, "no-credits" when the key's own limit or the account balance is
 * used up, else "ok" with the smaller of the two in dollars. `POST /api/decide` forwards
 * `{ model, state, questions }` to `openRouter.systemOne.create` and returns the response.
 * `readJson` collects a request body and `sendJson` writes a response. Failures answer with
 * OpenRouter's own status code (401 invalid key, 402 no credits) or 502, plus `{ error }`.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { OpenRouter } from '@openrouter/sdk';
import type { DecisionsRequest } from '@openrouter/sdk/models';
import { OpenRouterError } from '@openrouter/sdk/models/errors';
import type { Connect, Plugin } from 'vite';

const statusOf = (error: unknown) => (error instanceof OpenRouterError ? error.statusCode : 502);

async function readJson(request: IncomingMessage): Promise<DecisionsRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as DecisionsRequest;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}

async function checkKey(openRouter: OpenRouter) {
  const metadata = await openRouter.apiKeys.getCurrentKeyMetadata().catch((error: unknown) => {
    if (statusOf(error) === 401) return null;
    throw error;
  });
  if (!metadata) return { state: 'invalid', message: 'OpenRouter rejected the API key in .env.', remaining: null };
  const balance = await openRouter.credits.getCredits().then(
    ({ data }) => data.totalCredits - data.totalUsage,
    (error: unknown) => {
      if ([401, 403].includes(statusOf(error))) return Infinity;
      throw error;
    },
  );
  const remaining = Math.min(metadata.data.limitRemaining ?? Infinity, balance);
  if (remaining <= 0) return { state: 'no-credits', message: 'The OpenRouter key has no credits left.', remaining: 0 };
  return { state: 'ok', message: 'OpenRouter key ready.', remaining: Number.isFinite(remaining) ? remaining : null };
}

export function decisionApi(apiKey: string): Plugin {
  const openRouter = new OpenRouter({ apiKey, appTitle: 'Decision Model Racers' });
  const mount = (middlewares: Connect.Server) => {
    middlewares.use('/api/decision-models', async (_request, response) => {
      try {
        const models = [];
        for await (const page of await openRouter.models.list({ outputModalities: 'decisions' })) {
          for (const model of page.result.data) {
            models.push({ id: model.id, name: model.name.split(': ').pop() ?? model.name, promptPrice: Number(model.pricing.prompt) * 1e6 });
          }
        }
        sendJson(response, 200, models);
      } catch (error) {
        sendJson(response, statusOf(error), { error: String(error) });
      }
    });
    middlewares.use('/api/key-status', async (_request, response) => {
      try {
        sendJson(response, 200, await checkKey(openRouter));
      } catch (error) {
        sendJson(response, statusOf(error), { error: String(error) });
      }
    });
    middlewares.use('/api/decide', async (request, response) => {
      try {
        const { model, state, questions } = await readJson(request);
        sendJson(response, 200, await openRouter.systemOne.create({ decisionsRequest: { model, state, questions } }));
      } catch (error) {
        sendJson(response, statusOf(error), { error: String(error) });
      }
    });
  };
  return {
    name: 'decision-api',
    configureServer: (server) => mount(server.middlewares),
    configurePreviewServer: (server) => mount(server.middlewares),
  };
}

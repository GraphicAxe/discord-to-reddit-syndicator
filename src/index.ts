import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { logger } from 'hono/logger';
import { createServer, getServerPort } from '@devvit/web/server';
import { api } from './routes/api';
import { triggers } from './routes/triggers';
import { cron, sendDiscordError } from './routes/cron.js';
import { settings } from '@devvit/settings';

const app = new Hono();

// Enable console logging for all Hono requests
app.use('*', logger());

// Capture and print detailed error logs to the terminal
app.onError(async (err, c) => {
  console.error('[Hono Server Error]:', err);
  try {
    const webhook = await settings.get<string>('discordWebhook');
    if (webhook) {
      await sendDiscordError(webhook, `HTTP Router Error (${c.req.method} ${c.req.path})`, err);
    }
  } catch (notifyErr) {
    console.error('Failed to notify Discord of Hono server error:', notifyErr);
  }
  return c.text('Internal Server Error', 500);
});

const internal = new Hono();

internal.route('/triggers', triggers);
internal.route('/cron', cron);

app.route('/api', api);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});

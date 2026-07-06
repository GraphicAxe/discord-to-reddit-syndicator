import { Hono } from 'hono';
import { redis } from '@devvit/redis';
import { runVideoCheck, runCommunityCheck } from './cron.js';

export const triggers = new Hono();

interface InstallRequest {
  subreddit?: {
    name?: string;
  };
}

triggers.post('/on-app-install', async (c) => {
  const input = await c.req.json<InstallRequest>();
  console.log('App installed to subreddit: r/' + input.subreddit?.name);

  if (input.subreddit?.name) {
    await redis.set('installed_subreddit', input.subreddit.name);
  }

  console.log('[onAppInstall] Triggering manual check-video-post and check-community-post checks...');
  try {
    await runVideoCheck();
    await runCommunityCheck();
    console.log('[onAppInstall] Manual check executions finished successfully.');
  } catch (err) {
    console.error('[onAppInstall] Error executing check logic during install:', err);
  }

  return c.json(
    {
      status: 'success',
    },
    200
  );
});

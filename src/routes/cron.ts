import { Hono } from 'hono';
import { reddit } from '@devvit/reddit';
import { media } from '@devvit/media';
import { redis } from '@devvit/redis';
import { settings } from '@devvit/settings';

// ---------------------------------------------------------------------------
// Types matching the JSON payloads that n8n writes to Cloudflare R2
// ---------------------------------------------------------------------------

type VideoPostPayload = {
  /** Unique ID (YouTube video ID) used for deduplication */
  id: string;
  /** Post title */
  title: string;
  /** Full YouTube URL */
  url: string;
  /** Author name */
  author: string;
};

type CommunityPostPayload = {
  /** Unique ID used for deduplication */
  id: string;
  /** Post title */
  title: string;
  /** Markdown body text (may include a link back to the original) */
  body: string;
  /** Author name */
  author: string;
  /** Optional list of multiple image URLs (as array or stringified JSON) */
  imageUrls?: string[] | string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REDIS_KEY_VIDEO = 'last_video_id';
const REDIS_KEY_COMMUNITY = 'last_community_id';

async function getDiscordBotToken(): Promise<string> {
  const token = await settings.get<string>('discordBotToken');
  if (!token) throw new Error('Devvit setting "discordBotToken" is not set. Set it in Subreddit Mod Tools -> Apps -> aphmau-updates.');
  return token;
}

const MOCK_MODE = false; // Set to false once moving forward to production

async function fetchPayloadFromDiscord<T>(channelId: string, botToken: string, isVideo: boolean): Promise<T | null> {
  if (MOCK_MODE) {
    if (isVideo) {
      return {
        id: "mock-video-id-" + Math.floor(Date.now() / 60000), // Unique ID per minute
        title: "Devvit Automation Test Video!",
        url: "https://www.youtube.com/watch?v=M7lc1UVf-VE", // Public mock video URL
        author: "Author"
      } as unknown as T;
    } else {
      return {
        id: "mock-community-id-" + Math.floor(Date.now() / 60000),
        title: "Devvit Automation Test Community Post!",
        body: "This is a test community post body from the Devvit Hono application. Testing Discord dead drop proxy pull architecture!",
        author: "Aphmau",
        imageUrls: "[\"https://upload.wikimedia.org/wikipedia/commons/b/b6/Image_created_with_a_mobile_phone.png\"]"
      } as unknown as T;
    }
  }

  if (!channelId) {
    throw new Error(`Discord channel ID is not configured. Set it in Subreddit Mod Tools -> Apps -> aphmau-updates.`);
  }

  const url = `https://discord.com/api/v10/channels/${channelId}/messages?limit=1`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bot ${botToken}`
    }
  });

  if (res.status === 404) {
    throw new Error(`Discord channel ${channelId} not found (404). Ensure Bot is invited to your server and channel ID is correct.`);
  }
  if (res.status === 403) {
    throw new Error(`Discord permission error (403). Ensure Bot has "View Channel" and "Read Message History" permissions in that channel.`);
  }
  if (!res.ok) {
    throw new Error(`Discord API fetch failed: ${res.status} ${res.statusText}`);
  }

  interface DiscordMessage {
    content: string;
  }
  const messages = await res.json() as DiscordMessage[];
  if (!messages || messages.length === 0) {
    console.log(`[discord-fetch] No messages found in channel ${channelId}, skipping.`);
    return null;
  }

  const latestMessage = messages[0];
  if (!latestMessage || !latestMessage.content) {
    console.log(`[discord-fetch] Latest message in channel ${channelId} has empty content, skipping.`);
    return null;
  }

  let cleanedContent = latestMessage.content.trim();
  // Strip Discord code block markdown (```json ... ``` or ``` ... ```) if present
  if (cleanedContent.startsWith('```')) {
    cleanedContent = cleanedContent.replace(/^```[a-zA-Z]*\s*/, '');
    cleanedContent = cleanedContent.replace(/\s*```$/, '');
  }

  try {
    return JSON.parse(cleanedContent) as T;
  } catch (err) {
    throw new Error(`Latest message in channel ${channelId} is not valid JSON. Message content: "${cleanedContent.substring(0, 100)}..."`, { cause: err });
  }
}

async function sendDiscordNotification(webhookUrl: string, title: string, postUrl: string, type: 'video' | 'community') {
  const embedTitle = type === 'video' ? 'New Video Posted to Reddit' : 'New Community Post Posted to Reddit';
  const description = type === 'video' ? 'The automation ran successfully and posted a new link.' : 'The automation ran successfully and posted a new Community Post.';
  
  const payload = {
    content: "@everyone ✅ **WORKFLOW SUCCESS** ✅",
    embeds: [
      {
        title: embedTitle,
        description: description,
        color: 5763719,
        fields: [
          {
            name: "Post Title",
            value: title
          },
          {
            name: "Post URL",
            value: `https://reddit.com${postUrl}`
          }
        ],
        footer: {
          text: "Devvit Automation • Status: Healthy"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error(`Discord notification failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`Failed to send Discord notification:`, err);
  }
}

export async function sendDiscordError(webhookUrl: string, taskName: string, error: Error) {
  const stack = error.stack ? error.stack.split('\n').slice(0, 4).join('\n') : 'No stack trace available';
  const payload = {
    content: "@everyone 🚨 **BOT EXCEPTION** 🚨",
    embeds: [
      {
        title: `Devvit Bot Exception: ${taskName}`,
        description: `An exception occurred during execution. Please check the logs.`,
        color: 16711680, // Red color
        fields: [
          {
            name: "Error Message",
            value: error.message || 'Unknown error'
          },
          {
            name: "Stack Trace Details",
            value: `\`\`\`\n${stack}\n\`\`\``
          }
        ],
        footer: {
          text: "Devvit Automation • Status: Unhealthy"
        },
        timestamp: new Date().toISOString()
      }
    ]
  };

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.error(`Discord error notification failed: ${res.status} ${res.statusText}`);
    }
  } catch (err) {
    console.error(`Failed to send Discord error notification:`, err);
  }
}


export async function runVideoCheck() {
  try {
    const botToken = await getDiscordBotToken();
    const channelId = await settings.get<string>('videoChannelId') || '';
    const payload = await fetchPayloadFromDiscord<VideoPostPayload | VideoPostPayload[]>(channelId, botToken, true);
    if (!payload) {
      console.log('[video-cron] No payload found on Discord, skipping.');
      return;
    }

    // Support both single objects and JSON arrays of objects from n8n
    const item = Array.isArray(payload) ? payload[0] : payload;
    if (!item || !item.id) {
      console.log('[video-cron] Invalid payload format, skipping.');
      return;
    }

    const lastId = await redis.get(REDIS_KEY_VIDEO);
    if (lastId === item.id) {
      console.log(`[video-cron] Already posted id="${item.id}", skipping.`);
      return;
    }

    const subredditName = (await redis.get('installed_subreddit')) || 'aphmaufandom';
    console.log(`[video-cron] Posting new video to r/${subredditName}: "${item.title}" (${item.id})`);
    const post = await reddit.submitPost({
      subredditName,
      title: item.title,
      url: item.url,
    });

    await redis.set(REDIS_KEY_VIDEO, item.id);
    console.log(`[video-cron] Posted successfully: ${post.id}`);

    const discordWebhook = await settings.get<string>('discordWebhook');
    if (discordWebhook) {
      await sendDiscordNotification(discordWebhook, item.title, post.permalink, 'video');
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[video-cron] Exception occurred: ${errorMsg}`, err);
    try {
      const discordWebhook = await settings.get<string>('discordWebhook');
      if (discordWebhook) {
        await sendDiscordError(discordWebhook, 'Video Post Sync Job', err instanceof Error ? err : new Error(errorMsg));
      }
    } catch (discordErr) {
      console.error(`[video-cron] Failed to dispatch Discord error notification:`, discordErr);
    }
    throw err;
  }
}

export async function runCommunityCheck() {
  try {
    const botToken = await getDiscordBotToken();
    const channelId = await settings.get<string>('communityChannelId') || '';
    const payload = await fetchPayloadFromDiscord<CommunityPostPayload | CommunityPostPayload[]>(channelId, botToken, false);
    if (!payload) {
      console.log('[community-cron] No payload found on Discord, skipping.');
      return;
    }

    // Support both single objects and JSON arrays of objects from n8n
    const item = Array.isArray(payload) ? payload[0] : payload;
    if (!item || !item.id) {
      console.log('[community-cron] Invalid payload format, skipping.');
      return;
    }

    const lastId = await redis.get(REDIS_KEY_COMMUNITY);
    if (lastId === item.id) {
      console.log(`[community-cron] Already posted id="${item.id}", skipping.`);
      return;
    }

    const dateString = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const authorName = item.author || 'Aphmau';
    const redditTitle = `New Community Post from ${authorName} - ${dateString}`;

    const subredditName = (await redis.get('installed_subreddit')) || 'aphmaufandom';
    console.log(`[community-cron] Posting new community post to r/${subredditName}: "${redditTitle}" (${item.id})`);

    let post;

    // Gather all unique image URLs (supports array or stringified JSON of image URLs)
    const imageUrls: string[] = [];

    let rawImageUrls = item.imageUrls;
    if (typeof rawImageUrls === 'string') {
      try {
        rawImageUrls = JSON.parse(rawImageUrls);
      } catch (err) {
        console.log('[community-cron] Failed to parse stringified imageUrls:', err);
      }
    }

    if (rawImageUrls && Array.isArray(rawImageUrls)) {
      for (const url of rawImageUrls) {
        if (url && typeof url === 'string' && !imageUrls.includes(url)) {
          imageUrls.push(url);
        }
      }
    }

    if (imageUrls.length > 0) {
      const imageBlocks = [];
      for (const url of imageUrls) {
        try {
          const asset = await media.upload({ url, type: 'image' });
          imageBlocks.push({
            e: 'img',
            id: asset.mediaId,
          });
        } catch (err) {
          console.error(`[community-cron] Failed to upload image "${url}" to Reddit CDN:`, err);
        }
      }

      // Parse markdown links to build rich text paragraph blocks (matching original n8n behavior)
      const paragraphContent = [];
      const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let lastIndex = 0;
      let match;

      while ((match = markdownLinkRegex.exec(item.body)) !== null) {
        if (match.index > lastIndex) {
          paragraphContent.push({
            e: 'text',
            t: item.body.substring(lastIndex, match.index),
          });
        }
        paragraphContent.push({
          e: 'link',
          u: match[2] || '',
          t: match[1] || '',
        });
        lastIndex = markdownLinkRegex.lastIndex;
      }

      if (lastIndex < item.body.length) {
        paragraphContent.push({
          e: 'text',
          t: item.body.substring(lastIndex),
        });
      }

      if (paragraphContent.length === 0) {
        paragraphContent.push({ e: 'text', t: '' });
      }

      const richTextObject = {
        document: [
          {
            e: 'par',
            c: paragraphContent,
          },
          ...imageBlocks,
        ],
      };

      post = await reddit.submitPost({
        subredditName,
        title: redditTitle,
        richtext: richTextObject,
      });
    } else {
      // Text / self post
      post = await reddit.submitPost({
        subredditName,
        title: redditTitle,
        text: item.body,
      });
    }

    await redis.set(REDIS_KEY_COMMUNITY, item.id);
    console.log(`[community-cron] Posted successfully: ${post.id}`);

    const discordWebhook = await settings.get<string>('discordWebhook');
    if (discordWebhook) {
      await sendDiscordNotification(discordWebhook, redditTitle, post.permalink, 'community');
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[community-cron] Exception occurred: ${errorMsg}`, err);
    try {
      const discordWebhook = await settings.get<string>('discordWebhook');
      if (discordWebhook) {
        await sendDiscordError(discordWebhook, 'Community Post Sync Job', err instanceof Error ? err : new Error(errorMsg));
      }
    } catch (discordErr) {
      console.error(`[community-cron] Failed to dispatch Discord error notification:`, discordErr);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Hono router — endpoints called by the Devvit scheduler
// ---------------------------------------------------------------------------

export const cron = new Hono();

/**
 * Handles the "check-video-post" scheduled task.
 * Reads latest_video_post.json from R2 and submits a Reddit link post.
 */
cron.post('/check-video-post', async (c) => {
  await c.req.json();
  await runVideoCheck();
  return c.json({}, 200);
});

/**
 * Handles the "check-community-post" scheduled task.
 * Reads latest_community_post.json from R2 and submits a Reddit text or image post.
 */
cron.post('/check-community-post', async (c) => {
  await c.req.json();
  await runCommunityCheck();
  return c.json({}, 200);
});

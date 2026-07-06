# Community Feed Syndicator

A Reddit Devvit application designed to automatically syndicate community news, video updates, and announcements from an external feed provider to the subreddit.

## Architecture & How It Works

The app periodically fetches structured announcements from our feed provider using a scheduled pull model to minimize API traffic:

1. **Content Source:** The feed provider publishes new content, announcements, or videos as formatted JSON payloads into dedicated Discord channels.
2. **Scheduling:** Background tasks run periodically to fetch the latest channel message from Discord's official API.
3. **Syndication:** The app fetches the message text, parses it as a structured payload, matches the unique entry IDs against local Redis storage to prevent duplicate submissions, and publishes the updates to the subreddit.

---

## Configuration Settings

The app requires the following global settings configuration keys:

* **`discordBotToken`**: The authentication token for the Discord Bot used to read message feeds. Set with:
  ```bash
  npx devvit settings set discordBotToken "your-bot-token"
  ```
* **`videoChannelId`**: The ID of the Discord text channel holding the video post JSON payload. Set with:
  ```bash
  npx devvit settings set videoChannelId "channel-id"
  ```
* **`communityChannelId`**: The ID of the Discord text channel holding the community post JSON payload. Set with:
  ```bash
  npx devvit settings set communityChannelId "channel-id"
  ```
* **`discordWebhook`**: An optional Discord webhook URL to send success notifications when a post is created on Reddit. Set with:
  ```bash
  npx devvit settings set discordWebhook "https://discord.com/api/webhooks/..."
  ```

---

## Scripts & CLI Commands

* `npm run dev` (or `npx devvit playtest <subreddit>`): Starts a local playtest session.
* `npm run build`: Compiles the server build using Vite.
* `npm run deploy` (or `npx devvit upload`): Uploads a new app bundle to Reddit.
* `npm run type-check`: Runs TypeScript type checks.
* `npm run lint`: Runs ESLint checks.

---

## Directory Structure

```
.
├── devvit.json            # Configuration and domain permissions manifest
├── package.json           # Scripts and dependencies configuration
├── tsconfig.json          # TypeScript compiler configuration
├── src/
│   ├── index.ts           # Hono server entrypoint
│   └── routes/
│       ├── cron.ts        # Syndication logic and post creation
│       ├── triggers.ts    # App lifecycle triggers (e.g. onAppInstall)
│       └── api.ts         # Generic public API routes
```

---

## Feed Payload Formats

The Discord channel messages fetched by this application are expected to be formatted as raw JSON payloads adhering to the following structures:

### 1. Video Feed Payload (`VideoPostPayload`)
Expected on the `videoChannelId` channel:
```json
{
  "id": "youtube-video-id",
  "title": "New Video Title",
  "url": "https://www.youtube.com/watch?v=...",
  "author": "Aphmau"
}
```

### 2. Community Feed Payload (`CommunityPostPayload`)
Expected on the `communityChannelId` channel:
```json
{
  "id": "unique-post-id",
  "title": "New Community Announcement",
  "body": "Markdown formatted body text",
  "author": "Aphmau",
  "imageUrls": "[\"https://example.com/image1.jpg\"]"
}
```

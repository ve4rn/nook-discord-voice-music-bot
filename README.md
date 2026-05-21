# Nook

**A multilingual Discord bot for music, private voice channels, and polished community audio experiences.**

Nook is built for Discord servers that want music to feel clean, modern, and easy to use. It combines Lavalink playback, Spotify-first metadata, localized interaction panels, persistent queue state, curated playlists, and temporary private voice rooms in one open-source bot.

The goal is simple: make Discord music and voice features feel premium without locking everything behind a closed product.

* **Add the hosted bot:** [Add Nook for free](https://discord.com/oauth2/authorize?client_id=1493567210948661330)
* **Join the community:** [Nook Support Server](https://discord.gg/mf6993bmQ8)
* **Contribute:** translations, playlists, bug fixes, UX improvements, Lavalink/audio reliability, and private voice features are all welcome.

## Summary

* [Why Nook?](#why-nook)
* [Highlights](#highlights)
* [Screens and UX Direction](#screens-and-ux-direction)
* [Commands](#commands)
* [Metadata vs Playback](#metadata-vs-playback)
* [Music Features](#music-features)
* [Private Voice Channels](#private-voice-channels)
* [Languages and Translations](#languages-and-translations)
* [Self-Hosting](#self-hosting)
* [Redis and music stats](#redis-and-music-stats)

## Why Nook?

Most Discord music bots either feel outdated, overloaded, or fragile. Nook focuses on three things:

1. **A better user experience** - clean panels, localized messages, interactive controls, and queue visibility.
2. **Better metadata** - Spotify and Deezer are used first for track titles, artists, covers, and source links.
3. **A voice-first Discord workflow** - music, private voice channels, and voice-channel status updates work together instead of feeling like separate features.

Nook is not trying to be the biggest bot. It is trying to be one of the cleanest foundations for building modern Discord music and voice experiences.

## Highlights

* Spotify-first metadata for title, artist, artwork, and source links
* Lavalink playback with a fallback-first audio resolution strategy
* Localized music panels for English, French, Spanish, and German
* Persistent queue and audio session state with Prisma + PostgreSQL
* Curated playlists and playlist import support
* Interactive `Start Listening`, `Let's play`, `Control`, and `Queue` panels
* Temporary private voice channels with setup commands
* Voice-channel status updates while music is playing or paused
* Clear service/repository architecture for contributors
* Self-hostable with Node.js, PostgreSQL, and Lavalink

## Screens and UX Direction

Nook is designed around Discord-native components instead of plain text commands.

The music experience is panel-first:

1. A member starts with `Start Listening`
2. Nook helps them select or join a voice channel
3. The `Let's play` panel offers curated playlists
4. The `Control` and `Queue` panels handle playback and session management

The long-term direction is to make Nook feel like a small music app living inside Discord: visual, localized, responsive, and easy to understand even for non-technical users.

## Commands

| Command     | Description                                                     |
| ----------- | --------------------------------------------------------------- |
| `/play`     | Play a track, resolve a URL, or import a supported playlist URL |
| `/playlist` | Launch one of Nook's curated playlists                          |
| `/queue`    | Open the current queue panel                                    |
| `/skip`     | Vote to skip the current track                                  |
| `/join`     | Connect Nook to your voice channel                              |
| `/leave`    | Disconnect Nook from voice                                      |
| `/setup`    | Configure private voice channels and language                   |
| `/help`     | Show help and utility information                               |

There is also a private development command at:

```text
src/commands/private/base/test.ts
```

It can emit internal lifecycle events such as `guildCreate` and `guildDelete` during development.

There is also an optional private lifecycle log channel controlled by:

```env
PRIVATE_LOGS_CHANNEL_ID=your_private_logs_channel_id
```

When this variable is set:

* `guildCreate` sends an English container log in green
* `guildDelete` sends an English container log in red
* manually emitted lifecycle events from the private `/test` command send the same log in orange

## Metadata vs Playback

Nook separates what users see from where the playable audio actually comes from.

Spotify and Deezer are prioritized for display metadata:

* title
* artist
* cover artwork
* source URL

Then Lavalink resolves the playable audio using a fallback chain:

1. ISRC search when available
2. `ytmsearch:{artist} - {title}`
3. `ytsearch:{artist} - {title}`
4. SoundCloud fallback
5. direct or original source when Lavalink can read it

This means Nook can show clean Spotify metadata while still using the most reliable playable source available for the audio stream.

## Music Features

Nook currently includes:

* localized `Now Playing`, `No current track`, `Queue`, and playlist panels
* queue entries with `Added by {member}`
* vote-based `skip` and `previous`
* shuffle support with useful feedback when the queue is too short
* stop and disconnect handling with session summary panels
* AFK pause handling
* automatic voice status updates such as the current track title or `[Paused]`

When the voice channel becomes empty, Nook pauses immediately, updates the voice status, and keeps a short AFK window before disconnecting.

## Private Voice Channels

Nook can create and manage temporary private voice rooms.

The private voice system supports:

* creator voice channel configuration
* destination category configuration
* default language setup
* owner panel behavior
* empty channel cleanup
* mention TTL behavior

Private voice channels are configured through `/setup`, making the feature accessible without manually editing environment variables.

## Languages and Translations

Nook loads runtime copy from the root `messages/` directory.

Supported languages:

* English: `en`
* French: `fr`
* Spanish: `es`
* German: `de`

Long Discord locales are normalized automatically:

```text
en-US -> en
fr-FR -> fr
```

### Add a translation

Create a new file in `messages/` using the locale code:

```text
messages/it.json
messages/pt-BR.json
messages/nl.json
```

Then copy the structure from an existing language file and translate the values.

Translation contributions are one of the easiest ways to help Nook grow.

## Self-Hosting

Self-hosting is optional. Use it if you want your own bot token, database, Lavalink node, playlists, support links, or custom source modifications.

### Requirements

* Node.js 22+
* Java 17+ for Lavalink
* PostgreSQL
* npm
* a Discord application and bot token

### Environment Variables

Create a `.env` file:

```env
TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_id
GUILD_ID=your_test_guild_id
DATABASE_URL=postgresql://user:password@localhost:5432/nook?schema=public

LAVALINK_HOST=localhost
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_SECURE=false

SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
DEEZER_ACCESS_TOKEN=your_deezer_access_token

SUPPORT_SERVER_URL=https://discord.gg/your_invite
REPOSITORY_URL=https://github.com/you/nook

APP_ENV=dev
NODE_ENV=development

AUDIO_ENERGY_SAVING_IDLE_MS=1800000
AUDIO_STATS_ENABLED=true
AUDIO_STATS_FLUSH_INTERVAL_MS=60000
REDIS_URL=redis://localhost:6379
REDIS_KEY_PREFIX=nook
PRIVATE_VOICE_CREATE_CHANNEL_ID=000000000
PRIVATE_VOICE_CATEGORY_ID=000000000
PVC_LANG=fr
PVC_MAX_ALLOWED_USERS=10
PVC_PANEL_MENTION_TTL_MS=3000
PVC_EMPTY_CHANNEL_SWEEP_MS=60000
PRISMA_MAX_CONCURRENCY=6
NO_COLOR=false
```

Notes:

* `APP_ENV=dev` enables targeted debug logs for integrations such as Spotify and Deezer.
* `GUILD_ID` is optional, but useful for faster development command registration.
* `AUDIO_ENERGY_SAVING_IDLE_MS` defines how long a music session can stay without real interaction before Nook enters Energy Saving mode and asks listeners to confirm they are still there.
* `AUDIO_STATS_ENABLED` enables background collection for future music statistics.
* `AUDIO_STATS_FLUSH_INTERVAL_MS` controls how often in-memory music stat deltas are checkpointed and flushed.
* `REDIS_URL` enables the persistent music stats recovery buffer used to restore unflushed deltas on the next boot.
* `REDIS_KEY_PREFIX` namespaces Redis keys so multiple local environments do not collide.
* `PRIVATE_VOICE_*` values can stay unset if you prefer configuring private voice through Discord commands.
* `PVC_PANEL_MENTION_TTL_MS` controls how long temporary mention messages stay visible before deletion, both for private voice panels and for music session resume prompts.
* `MusicCatalogTrack` is the canonical song entity used by music stats, rankings, and future listening history features.
* `MusicCatalogTrackSource` stores known external identities for a canonical song such as Spotify, Deezer, YouTube, and SoundCloud.
* `MusicMonthlyUserTrackStat` stores monthly per-user per-track aggregates keyed by `MusicCatalogTrack.id`.
* Stats never aggregate directly on raw title, URL, or playback source.
* Canonical resolution priority is:
  1. normalized ISRC
  2. reliable `source + sourceId`
  3. fallback canonical hash with normalized title, normalized artist, and a 5-second duration bucket
* Fallback canonical keys are versioned as `fallback:v1:*` so future normalization changes can introduce a new version without breaking existing historical rows.
* Music stats are collected in memory first, mirrored into Redis for crash recovery, then flushed intelligently into PostgreSQL on meaningful playback events and on the periodic interval.
* On boot, any pending Redis stat deltas are replayed into PostgreSQL and then cleared so the live cache can restart from a clean state.
* Metadata source and playback source are intentionally tracked separately:
  * metadata source is preferred for canonical identity resolution
  * playback source can still be attached as an auxiliary external source

### Redis and music stats

Redis is optional, but strongly recommended if you want to reduce stat loss after an unexpected bot crash.

What Redis does in Nook:

* it is not the main database
* it is not the live source of truth for music stats
* it is used as a persistent recovery buffer between in-memory collection and PostgreSQL

The current flow is:

1. a track starts playing
2. Nook resolves a canonical catalog track for stats
3. the current listening session is tracked in memory
4. meaningful stat checkpoints are mirrored into Redis
5. PostgreSQL is updated on meaningful playback events and on the periodic flush interval
6. once PostgreSQL is updated successfully, the Redis checkpoint is updated or cleared

At the next boot:

* Nook pings Redis
* if Redis still contains pending stat deltas from a previous interrupted runtime, they are replayed into PostgreSQL
* after a successful restore, those Redis entries are deleted

This means:

* memory gives the best runtime performance
* Redis reduces losses between two flushes if the Node process dies
* PostgreSQL remains the final long-term storage

If `REDIS_URL` is not set:

* stats still work
* collection still happens in memory
* PostgreSQL still receives flushes
* but a hard crash can lose the deltas accumulated since the last successful flush

### How track stats work today

Nook is already collecting the foundations required for future track statistics features.

Current storage roles:

* `MusicCatalogTrack`
  * the canonical song entity used for stats
  * one logical song should eventually map to one canonical catalog row
* `MusicCatalogTrackSource`
  * stores known external identities for that song
  * Spotify, Deezer, YouTube, SoundCloud, and future providers can all be attached here
* `MusicMonthlyUserTrackStat`
  * stores monthly aggregates per user and per canonical track

Current aggregation behavior:

* `playCount` increases when a track really starts playing
* `playedMs` accumulates real listened time
* listened time is not written every second
* writes happen on meaningful lifecycle events such as pause, track change, stop, disconnect, and periodic flush

This keeps the system efficient while still preserving useful history.

### Canonical track resolution

Stats never aggregate directly on:

* raw title
* raw URL
* raw playback source

Instead, Nook resolves every played track to a canonical catalog track using this priority:

1. normalized ISRC
2. reliable `source + sourceId`
3. fallback hash using normalized title, normalized artist, and a 5-second duration bucket

Why this matters:

* the same song may be played from Spotify metadata but resolved to YouTube audio
* the same title may exist with slightly different URLs
* the same track can reappear after a restored session

The resolver is designed to give stats a stable identity even when playback origin changes.

There is still one intentional limitation:

* if no strong identity exists and the title changes too much, the fallback may still create a separate canonical track

That is acceptable for now because false separation is safer than false merging.

### Future of music stats

This first generation of stats is intentionally infrastructure-first.

The goal right now is:

* start collecting reliable history early
* avoid building user-facing stats on top of weak identities
* make later commands and panels use an already populated dataset

This prepares Nook for future features such as:

* top tracks per user
* top tracks per month
* listening recaps
* most played tracks in a guild
* richer queue and recommendation features
* source comparison and metadata quality analysis

In other words, the bot is already building the historical layer now so that future stats features are not empty or misleading on day one.

### Installation

Install dependencies:

```bash
npm install
```

Generate Prisma client:

```bash
npx prisma generate
```

Apply migrations:

```bash
npx prisma migrate deploy
```

Download Lavalink:

```bash
npm run setup:lavalink
```

Start Lavalink:

```bash
npm run start:lavalink
```

Build Nook:

```bash
npm run build
```

Start the bot:

```bash
npm start
```

## Project Structure

```text
messages/                    Runtime i18n files loaded by locale code
prisma/                      Prisma schema and migrations
scripts/                     PowerShell helpers for Lavalink setup/start
lavalink/                    Local Lavalink runtime files and configuration
src/
  commands/                  Public and private slash commands
  config/                    Env parsing, builders, Discord wiring, shared config
  domain/                    Domain errors and domain-level primitives
  events/                    Discord event handlers
  repositories/              Prisma-backed persistence layer
  services/                  Business logic
  types/                     Shared DTOs and state types
  utils/                     Small helpers
dist/                        Compiled JavaScript output
index.js                     Runtime entry point
```

## Architecture

The codebase is organized to keep Discord commands thin and business logic testable.

### Audio

Main entry points:

* `src/services/audio/AudioManager.ts`

  * session lifecycle
  * join, leave, pause, stop
  * AFK handling
  * queue and resume state
  * voice status updates
* `src/services/audio/TrackSearchService.ts`

  * autocomplete
  * Spotify and Deezer metadata enrichment
  * audio resolution fallback strategy
  * playlist import helpers
* `src/services/audio/audioPanel.ts`

  * `Let's play`, `Control`, `Queue`, neutral info, and error panels
* `src/services/audio/audioInteractions.ts`

  * button, select, and modal routing for music panels
* `src/repositories/AudioStateRepository.ts`

  * persisted audio state through Prisma

### Conventions

* environment variables are parsed in `src/config/env.ts`
* slash commands delegate to services
* repositories own database access
* i18n messages live in `messages/`
* Discord-facing responses should use localized containers instead of raw `content`
* user-facing errors should be clear, localized, and actionable

## Ready-Made Playlists

Curated playlists live in:

```text
src/services/audio/playlists.ts
```

The `Let's play` panel and `/playlist` command both use these definitions.

Nook currently clamps curated playlist launch to the first 10 tracks when using the instant-launch flow.

Playlist contributions are welcome. Good playlist additions should be:

* broadly useful for Discord communities
* clearly named
* not too niche by default
* safe for general-purpose servers
* easy to localize in UI copy

## Useful Scripts

```bash
npm run build
```

Compile TypeScript into `dist/`.

```bash
npm run typecheck
```

Run TypeScript checks without emitting files.

```bash
npm test
```

Run the Vitest suite.

```bash
npm run lint
```

Run ESLint.

```bash
npm run setup:lavalink
```

Download Lavalink locally.

```bash
npm run start:lavalink
```

Start Lavalink with the local config.

## Discord Permissions

For the full experience, Nook should be able to:

* view channels
* send messages
* use slash commands
* embed links and send components
* read message history
* connect to voice channels
* speak in voice channels
* manage channels for private voice rooms

Nook performs explicit permission checks before sending music panels, joining voice, or controlling playback.

## Troubleshooting

### Slash commands do not appear

* verify `CLIENT_ID`
* verify bot scopes and command registration
* use `GUILD_ID` for faster private-guild iteration

### Music metadata looks right, but playback does not start

* make sure Lavalink is running
* verify `LAVALINK_HOST`, `LAVALINK_PORT`, and `LAVALINK_PASSWORD`
* check that your Lavalink node supports `ytmsearch` if you expect YouTube Music fallback

### Spotify metadata does not show up

* verify `SPOTIFY_CLIENT_ID`
* verify `SPOTIFY_CLIENT_SECRET`
* enable `APP_ENV=dev` and check Spotify fallback logs

### Deezer playlist import fails

* verify `DEEZER_ACCESS_TOKEN`
* confirm the URL is a supported Deezer playlist URL

### Prisma fails

* verify PostgreSQL connectivity
* verify `DATABASE_URL`
* run `npx prisma generate`
* run `npx prisma migrate deploy`

## Contributing

Nook is open to contributions of all sizes. You do not need to rewrite the whole bot to help.

Great first contributions include:

* fixing typos in `messages/`
* adding a new translation
* improving error messages
* adding curated playlists
* improving README examples
* reporting broken playback sources
* improving private voice channel UX
* adding tests around queue behavior

Larger contributions are also welcome:

* better Lavalink fallback handling
* improved playlist import support
* richer queue controls
* better moderation around unsafe playlist content
* dashboard or web preview ideas
* improved session persistence
* cleaner onboarding for new guilds

### Contribution workflow

1. Fork the repository
2. Create a feature branch
3. Keep the change focused
4. Run checks locally
5. Open a pull request with a clear explanation

Recommended checks before opening a pull request:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

A good pull request should explain:

* what changed
* why it matters
* how it was tested
* screenshots or recordings if the Discord UI changed

## Roadmap Ideas

These are areas where contributors can help shape Nook:

* more translations
* better playlist discovery
* improved queue search
* richer private voice owner controls
* better support for large guilds
* cleaner onboarding flow for first-time server admins
* more reliable metadata fallback behavior
* optional web landing page or docs site
* more automated tests for audio session state

## Security

Never commit tokens, secrets, database URLs, Lavalink passwords, or private Discord IDs.

If you find a security issue, please report it privately through the support server instead of opening a public issue with sensitive details.

## License

Nook is open-source. Check the repository license before reusing, modifying, or redistributing the project.

## Credits

Built with care for Discord communities that want a better music and voice experience.

If Nook helps your server or your own project, consider starring the repository, joining the support server, or contributing a small improvement.

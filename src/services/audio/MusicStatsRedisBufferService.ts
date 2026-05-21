import { createClient, type RedisClientType } from "@redis/client";
import { env } from "../../config/env.js";

export type PersistedMusicStatsEntry = {
  guildId: string;
  userId: string;
  trackId: string;
  monthKey: string;
  segmentStartedAt: number | null;
  playedMsDelta: number;
  playCountDelta: number;
  persistedAt: number;
};

type MusicStatsRedisBufferServiceOptions = {
  url?: string | null;
  keyPrefix?: string;
};

export class MusicStatsRedisBufferService {
  private readonly url: string | null;
  private readonly keyPrefix: string;
  private client: RedisClientType | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(options: MusicStatsRedisBufferServiceOptions = {}) {
    this.url = options.url ?? env.redis.url;
    this.keyPrefix = options.keyPrefix ?? env.redis.keyPrefix;
  }

  get enabled() {
    return Boolean(this.url);
  }

  async ping() {
    const client = await this.getClient();
    if (!client) return false;

    try {
      await client.ping();
      return true;
    } catch (error) {
      console.error("[MusicStatsRedis] Redis ping failed", error);
      return false;
    }
  }

  async init() {
    if (!this.enabled || this.client?.isOpen) return;
    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    const client = createClient({ url: this.url! });
    client.on("error", (error: unknown) => {
      console.error("[MusicStatsRedis] Redis client error", error);
    });

    this.connectPromise = client.connect()
      .then(() => {
        this.client = client;
      })
      .catch(async (error: unknown) => {
        console.error("[MusicStatsRedis] Failed to connect to Redis", error);
        await client.disconnect().catch(() => undefined);
      })
      .finally(() => {
        this.connectPromise = null;
      });

    await this.connectPromise;
  }

  async disconnect() {
    if (!this.client?.isOpen) return;
    await this.client.disconnect().catch(() => undefined);
    this.client = null;
  }

  async saveEntry(entry: PersistedMusicStatsEntry) {
    const client = await this.getClient();
    if (!client) return;

    await client.multi()
      .set(this.entryKey(entry.guildId), JSON.stringify(entry))
      .sAdd(this.entriesKey(), entry.guildId)
      .exec();
  }

  async deleteEntry(guildId: string) {
    const client = await this.getClient();
    if (!client) return;

    await client.multi()
      .del(this.entryKey(guildId))
      .sRem(this.entriesKey(), guildId)
      .exec();
  }

  async listEntries() {
    const client = await this.getClient();
    if (!client) return [] as PersistedMusicStatsEntry[];

    const guildIds = await client.sMembers(this.entriesKey());
    if (guildIds.length === 0) return [] as PersistedMusicStatsEntry[];

    const payloads = await client.mGet(guildIds.map((guildId: string) => this.entryKey(guildId)));
    const parsed: PersistedMusicStatsEntry[] = [];

    for (const payload of payloads) {
      if (!payload) continue;
      try {
        parsed.push(JSON.parse(payload) as PersistedMusicStatsEntry);
      } catch (error) {
        console.error("[MusicStatsRedis] Failed to parse buffered stats entry", error);
      }
    }

    return parsed;
  }

  private async getClient() {
    await this.init();
    return this.client?.isOpen ? this.client : null;
  }

  private entriesKey() {
    return `${this.keyPrefix}:music-stats:entries`;
  }

  private entryKey(guildId: string) {
    return `${this.keyPrefix}:music-stats:entry:${guildId}`;
  }
}

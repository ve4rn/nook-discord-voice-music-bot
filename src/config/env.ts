import dotenv from "dotenv";
import { EnvValidationError } from "../domain/errors/index.js";

dotenv.config();

export type RuntimeEnvironment = "development" | "test" | "production";
export type SupportedEnvLanguage = "fr" | "en" | "es" | "de";

export type AppEnv = {
  runtime: {
    nodeEnv: RuntimeEnvironment;
    appEnv: string;
    noColor: boolean;
  };
  discord: {
    token: string;
    clientId: string;
    guildId: string | null;
  };
  database: {
    url: string;
    maxConcurrency: number;
  };
  lavalink: {
    host: string;
    port: number;
    password: string;
    secure: boolean;
  };
  spotify: {
    clientId: string | null;
    clientSecret: string | null;
  };
  deezer: {
    accessToken: string | null;
  };
  links: {
    repositoryUrl: string | null;
    supportServerUrl: string | null;
  };
  privateVoice: {
    createChannelId: string | null;
    categoryId: string | null;
    language: SupportedEnvLanguage;
    maxAllowedUsers: number;
    panelMentionTtlMs: number;
    emptyChannelSweepMs: number;
  };
};

type RawEnv = Record<string, string | undefined>;

const PLACEHOLDER_CHANNEL_ID = "000000000";

function requiredString(raw: RawEnv, key: string): string {
  const value = raw[key]?.trim();
  if (!value) throw new EnvValidationError(key);
  return value;
}

function optionalString(raw: RawEnv, key: string): string | null {
  const value = raw[key]?.trim();
  if (!value || value.startsWith("your_")) return null;
  return value;
}

function optionalChannelId(raw: RawEnv, key: string): string | null {
  const value = optionalString(raw, key);
  if (!value || value === PLACEHOLDER_CHANNEL_ID) return null;
  return value;
}

function integer(raw: RawEnv, key: string, fallback: number): number {
  const parsed = Number.parseInt(raw[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedInteger(raw: RawEnv, key: string, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, integer(raw, key, fallback)));
}

function boolean(raw: RawEnv, key: string, fallback = false): boolean {
  const value = raw[key]?.trim().toLowerCase();
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

function runtimeEnvironment(raw: RawEnv): RuntimeEnvironment {
  const value = raw.NODE_ENV?.trim().toLowerCase();
  if (value === "production" || value === "test" || value === "development") return value;
  return "development";
}

function privateVoiceLanguage(raw: RawEnv): SupportedEnvLanguage {
  const value = raw.PVC_LANG?.trim().toLowerCase();
  if (value === "fr" || value === "en" || value === "es" || value === "de") return value;
  return "fr";
}

export function parseEnv(raw: RawEnv): AppEnv {
  return {
    runtime: {
      nodeEnv: runtimeEnvironment(raw),
      appEnv: raw.APP_ENV?.trim() || runtimeEnvironment(raw),
      noColor: boolean(raw, "NO_COLOR"),
    },
    discord: {
      token: requiredString(raw, "TOKEN"),
      clientId: requiredString(raw, "CLIENT_ID"),
      guildId: optionalString(raw, "GUILD_ID"),
    },
    database: {
      url: requiredString(raw, "DATABASE_URL"),
      maxConcurrency: boundedInteger(raw, "PRISMA_MAX_CONCURRENCY", 6, 1, 50),
    },
    lavalink: {
      host: optionalString(raw, "LAVALINK_HOST") ?? "localhost",
      port: boundedInteger(raw, "LAVALINK_PORT", 2333, 1, 65_535),
      password: optionalString(raw, "LAVALINK_PASSWORD") ?? "youshallnotpass",
      secure: boolean(raw, "LAVALINK_SECURE"),
    },
    spotify: {
      clientId: optionalString(raw, "SPOTIFY_CLIENT_ID"),
      clientSecret: optionalString(raw, "SPOTIFY_CLIENT_SECRET"),
    },
    deezer: {
      accessToken: optionalString(raw, "DEEZER_ACCESS_TOKEN"),
    },
    links: {
      repositoryUrl: optionalString(raw, "GITHUB_REPOSITORY_URL") ?? optionalString(raw, "REPOSITORY_URL"),
      supportServerUrl: optionalString(raw, "SUPPORT_SERVER_URL") ?? optionalString(raw, "DISCORD_SERVER_URL"),
    },
    privateVoice: {
      createChannelId: optionalChannelId(raw, "PRIVATE_VOICE_CREATE_CHANNEL_ID"),
      categoryId: optionalChannelId(raw, "PRIVATE_VOICE_CATEGORY_ID"),
      language: privateVoiceLanguage(raw),
      maxAllowedUsers: boundedInteger(raw, "PVC_MAX_ALLOWED_USERS", 10, 1, 25),
      panelMentionTtlMs: integer(raw, "PVC_PANEL_MENTION_TTL_MS", 3_000),
      emptyChannelSweepMs: integer(raw, "PVC_EMPTY_CHANNEL_SWEEP_MS", 60_000),
    },
  };
}

export const env = parseEnv(process.env);

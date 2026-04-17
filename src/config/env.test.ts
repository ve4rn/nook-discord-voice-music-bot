import { describe, expect, it } from "vitest";
import { EnvValidationError } from "../domain/errors/index.js";
import { parseEnv } from "./env.js";

const requiredEnv = {
  TOKEN: "token",
  CLIENT_ID: "client-id",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/nook",
};

describe("parseEnv", () => {
  it("validates required Discord and database variables", () => {
    expect(() => parseEnv({ CLIENT_ID: "client-id", DATABASE_URL: requiredEnv.DATABASE_URL })).toThrow(EnvValidationError);
  });

  it("normalizes defaults and optional placeholders", () => {
    const env = parseEnv({
      ...requiredEnv,
      SPOTIFY_CLIENT_ID: "your_spotify_client_id",
      LAVALINK_PORT: "2444",
      PVC_MAX_ALLOWED_USERS: "50",
      PVC_LANG: "de",
    });

    expect(env.lavalink.port).toBe(2444);
    expect(env.spotify.clientId).toBeNull();
    expect(env.privateVoice.maxAllowedUsers).toBe(25);
    expect(env.privateVoice.language).toBe("de");
  });
});

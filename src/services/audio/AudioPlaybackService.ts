import type { Player } from "lavalink-client";
import { LavalinkTimeoutError } from "../../domain/errors/index.js";

const LAVALINK_PLAY_RETRIES = 1;
const LAVALINK_PLAY_RETRY_DELAY_MS = 750;

export class AudioPlaybackService {
  async playWithRetry(player: Player, guildId: string, context: string, isPlayerPlaying?: () => boolean) {
    for (let attempt = 0; attempt <= LAVALINK_PLAY_RETRIES; attempt++) {
      try {
        await player.play();
        return;
      } catch (error) {
        if (!this.isTimeoutError(error)) throw error;

        console.warn(`[Audio] Lavalink play timeout for guild ${guildId} (${context}), attempt ${attempt + 1}/${LAVALINK_PLAY_RETRIES + 1}.`);
        if (attempt >= LAVALINK_PLAY_RETRIES) throw new LavalinkTimeoutError();

        await this.sleep(LAVALINK_PLAY_RETRY_DELAY_MS);
        if (isPlayerPlaying?.()) return;
      }
    }
  }

  private isTimeoutError(error: unknown) {
    const typed = error as { name?: string; message?: string };
    const message = typed?.message?.toLowerCase() ?? "";
    return typed?.name === "TimeoutError"
      || message.includes("operation was aborted due to timeout")
      || message.includes("timeout");
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

import { LavalinkNotReadyError, LavalinkTimeoutError, QueueLimitReachedError, TrackNotFoundError } from "../../domain/errors/index.js";
import type { AudioCommandCopy } from "./types.js";

type ErrorWithCode = Error & { code?: string };

function getErrorCode(error: unknown): string | null {
  if (
    error instanceof LavalinkNotReadyError
    || error instanceof LavalinkTimeoutError
    || error instanceof QueueLimitReachedError
    || error instanceof TrackNotFoundError
  ) {
    return error.code;
  }

  return error instanceof Error ? (error as ErrorWithCode).code ?? null : null;
}

export function getAudioUserErrorMessage(copy: AudioCommandCopy, error: unknown) {
  const code = getErrorCode(error);
  if (code === "LAVALINK_NOT_READY") return copy.errors.lavalinkNotReady;
  if (code === "LAVALINK_TIMEOUT") return copy.errors.lavalinkTimeout;
  if (code === "TRACK_NOT_FOUND") return copy.errors.trackNotFound;
  if (code === "QUEUE_LIMIT_REACHED") return copy.errors.queueLimit;
  return copy.errors.genericPlay;
}

export function isQueueLimitError(error: unknown) {
  return getErrorCode(error) === "QUEUE_LIMIT_REACHED";
}

import { BotError } from "./BotError.js";

export class LavalinkNotReadyError extends BotError {
  readonly code = "LAVALINK_NOT_READY";

  constructor() {
    super("Lavalink is not ready.");
  }
}

export class LavalinkTimeoutError extends BotError {
  readonly code = "LAVALINK_TIMEOUT";

  constructor() {
    super("Lavalink did not respond before the timeout.");
  }
}

export class TrackNotFoundError extends BotError {
  readonly code = "TRACK_NOT_FOUND";

  constructor() {
    super("No playable track was found.");
  }
}

export class QueueLimitReachedError extends BotError {
  readonly code = "QUEUE_LIMIT_REACHED";

  constructor() {
    super("The audio queue is full.");
  }
}

export class QueueNotFoundError extends BotError {
  readonly code = "QUEUE_NOT_FOUND";

  constructor() {
    super("The audio queue does not exist.");
  }
}

export class PlayerNotConnectedError extends BotError {
  readonly code = "PLAYER_NOT_CONNECTED";

  constructor() {
    super("The audio player is not connected.");
  }
}

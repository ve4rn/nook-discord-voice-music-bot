import { BotError } from "./BotError.js";

export class MissingDiscordPermissionError extends BotError {
  readonly code = "MISSING_DISCORD_PERMISSION";

  constructor(readonly permissions: string[]) {
    super(`Missing Discord permissions: ${permissions.join(", ")}`);
  }
}

export class BotUserUnavailableError extends BotError {
  readonly code = "BOT_USER_UNAVAILABLE";

  constructor() {
    super("The Discord bot user is not available.");
  }
}

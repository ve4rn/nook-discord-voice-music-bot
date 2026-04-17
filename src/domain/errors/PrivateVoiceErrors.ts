import { BotError } from "./BotError.js";

export class MissingGuildConfigError extends BotError {
  readonly code = "MISSING_GUILD_CONFIG";

  constructor(readonly guildId: string) {
    super(`Missing guild config for ${guildId}.`);
  }
}

export class UnauthorizedPrivateVoiceActionError extends BotError {
  readonly code = "UNAUTHORIZED_PRIVATE_VOICE_ACTION";

  constructor() {
    super("The member is not allowed to perform this private voice action.");
  }
}

export class PrivateVoiceCategoryNotFoundError extends BotError {
  readonly code = "PRIVATE_VOICE_CATEGORY_NOT_FOUND";

  constructor(readonly categoryId: string) {
    super(`Private voice category ${categoryId} was not found.`);
  }
}

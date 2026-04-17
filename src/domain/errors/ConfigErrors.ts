import { BotError } from "./BotError.js";

export class EnvValidationError extends BotError {
  readonly code = "ENV_VALIDATION_ERROR";

  constructor(readonly variableName: string) {
    super(`Missing or invalid environment variable: ${variableName}`);
  }
}

import { describe, expect, it } from "vitest";
import { SetupValidator } from "./SetupValidator.js";

describe("SetupValidator", () => {
  it("parses setup custom IDs and defaults the section", () => {
    const validator = new SetupValidator("nook_setup");

    expect(validator.parseCustomId("nook_setup:toggle:123")).toEqual({
      action: "toggle",
      guildId: "123",
      section: "menu",
    });
  });

  it("rejects custom IDs from another namespace", () => {
    const validator = new SetupValidator("nook_setup");

    expect(validator.parseCustomId("other:toggle:123:menu")).toBeNull();
  });

  it("normalizes language and section values", () => {
    const validator = new SetupValidator("nook_setup");

    expect(validator.parseLanguage("es")).toBe("es");
    expect(validator.parseLanguage("unknown")).toBe("fr");
    expect(validator.parseSection("timing")).toBe("timing");
    expect(validator.parseSection("unknown")).toBe("menu");
  });
});

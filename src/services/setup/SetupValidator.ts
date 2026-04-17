export type SetupLanguageValue = "fr" | "en" | "es" | "de";
export type SetupSectionValue = "menu" | "configuration" | "timing";

export type ParsedSetupCustomId = {
  action: string;
  guildId: string;
  section: SetupSectionValue;
};

export class SetupValidator {
  constructor(private readonly customIdPrefix: string) {}

  parseCustomId(raw: string): ParsedSetupCustomId | null {
    const [prefix, action, guildId, section] = raw.split(":");
    if (prefix !== this.customIdPrefix || !action || !guildId) return null;
    return { action, guildId, section: this.parseSection(section) };
  }

  parseLanguage(language: string | null | undefined): SetupLanguageValue {
    return language === "en" || language === "es" || language === "de" || language === "fr" ? language : "fr";
  }

  parseSection(section: string | null | undefined): SetupSectionValue {
    return section === "configuration" || section === "timing" || section === "menu" ? section : "menu";
  }
}

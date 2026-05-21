import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateVoiceManager } from "./PrivateVoiceManager.js";

export type BotLanguage = string;

type Primitive = string | number | boolean | null | undefined;
type InterpolationValues = Record<string, Primitive>;
export type PluralizedMessage = {
  one: string;
  other: string;
};
type PlaylistPluralMessages = {
  playlistQueued: PluralizedMessage;
  playlistPartiallyAdded: PluralizedMessage;
  listenerPresenceDescription: PluralizedMessage;
  listenerPresenceButton: PluralizedMessage;
};

export interface MessageTree {
  common: Record<string, string>;
  welcome: Record<string, string>;
  music: Record<string, string> & PlaylistPluralMessages;
  privateVoice: {
    accessPlaceholder: string;
    accessUpdated: string;
    channelNotManaged: string;
    channelRenameSuccess: string;
    controlPanelIntro: string;
    createReason: string;
    defaultChannelName: string;
    defaultChannelNameVowel?: string;
    invalidName: string;
    modalTitle: string;
    noLongerExists: string;
    notOwner: string;
    panelDescription: string;
    panelFooter: string;
    panelTitle: string;
    permissionAlert: string;
    permissionContexts: Record<string, string>;
    privateButton: string;
    privateModeLine: string;
    privateStatus: string;
    publicButton: string;
    publicModeLine: string;
    publicStatus: string;
    renameButton: string;
    renameRateLimited: string;
    renameInputLabel: string;
    transferNotice: string;
    unauthorizedJoin: string;
    updateReason: string;
  };
  setup: {
    title: string;
    intro: string;
    cats: string;
    current: string;
    notConfigured: string;
    sectionPlaceholder: string;
    menu: string;
    menuDesc: string;
    configuration: string;
    configurationDesc: string;
    timing: string;
    timingDesc: string;
    moduleTitle: string;
    active: string;
    inactive: string;
    enable: string;
    disable: string;
    enableFirst: string;
    languageTitle: string;
    languageDesc: string;
    languagePlaceholder: string;
    categoryTitle: string;
    categoryDesc: string;
    categoryPlaceholder: string;
    voiceTitle: string;
    voiceDesc: string;
    voicePlaceholder: string;
    panelTitle: string;
    panelDesc: string;
    panelPlaceholder: string;
    pingLabel: string;
    pingPlaceholder: string;
    cleanupLabel: string;
    cleanupPlaceholder: string;
    serverOnly: string;
    mismatch: string;
    adminOnly: string;
    invalid: string;
    ownerOption: string;
    ownerCurrent: string;
    moduleEnabledUpdate: string;
    moduleDisabledUpdate: string;
    languageUpdated: string;
    categoryUpdated: string;
    creatorChannelUpdated: string;
    ownerPanelUpdated: string;
    pingUpdated: string;
    cleanupUpdated: string;
  };
  help: {
    title: string;
    emptyCategory: string;
    addBot: string;
    repository: string;
    supportServer: string;
    categories: Record<string, string>;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_LANGUAGE = "en";

function resolveMessagesDir() {
  const candidates = [
    path.resolve(process.cwd(), "messages"),
    path.resolve(__dirname, "../../messages"),
  ];

  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    throw new Error(`No messages directory found. Tried: ${candidates.join(", ")}`);
  }

  return found;
}

const messagesDir = resolveMessagesDir();

function normalizeLocale(raw: string | null | undefined) {
  const normalized = (raw ?? "").trim().toLowerCase().replace(/\.json$/i, "");
  if (!normalized) return DEFAULT_LANGUAGE;
  return normalized.split(/[-_]/)[0] || DEFAULT_LANGUAGE;
}

function loadMessagesFile(fileName: string) {
  const filePath = path.resolve(messagesDir, fileName);
  return JSON.parse(readFileSync(filePath, "utf8")) as MessageTree;
}

function loadMessages() {
  const files = readdirSync(messagesDir)
    .filter(file => file.endsWith(".json"))
    .sort((left, right) => left.length - right.length || left.localeCompare(right));

  const entries = new Map<string, MessageTree>();
  for (const file of files) {
    const key = normalizeLocale(path.basename(file, ".json"));
    if (!entries.has(key)) {
      entries.set(key, loadMessagesFile(file));
    }
  }

  if (!entries.has(DEFAULT_LANGUAGE)) {
    throw new Error(`Missing default language file: ${DEFAULT_LANGUAGE}.json`);
  }

  return entries;
}

const messages = loadMessages();

export function parseLanguage(raw: string | null | undefined): BotLanguage {
  const normalized = normalizeLocale(raw);
  return messages.has(normalized) ? normalized : DEFAULT_LANGUAGE;
}

function interpolate(template: string, values?: InterpolationValues) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value == null ? "" : String(value);
  });
}

function readPath(tree: unknown, pathKey: string): string {
  const value = pathKey.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment];
    }
    return null;
  }, tree);

  return typeof value === "string" ? value : pathKey;
}

export function tp(template: PluralizedMessage, count: number, values?: InterpolationValues) {
  return interpolate(count === 1 ? template.one : template.other, values);
}

export function getAvailableLanguages(): BotLanguage[] {
  return Array.from(messages.keys()).sort((left, right) => {
    if (left === DEFAULT_LANGUAGE) return -1;
    if (right === DEFAULT_LANGUAGE) return 1;
    return left.localeCompare(right);
  });
}

export function getLanguageDisplayName(language: BotLanguage, uiLanguage?: BotLanguage) {
  try {
    const formatter = new Intl.DisplayNames([parseLanguage(uiLanguage)], { type: "language" });
    const label = formatter.of(language);
    return label ? label[0].toUpperCase() + label.slice(1) : language;
  } catch {
    return language;
  }
}

export async function getGuildLanguage(guildId: string | null | undefined): Promise<BotLanguage> {
  if (!guildId) return DEFAULT_LANGUAGE;
  const cached = privateVoiceManager.guildConfigCache.get(guildId);
  const config = cached ?? await privateVoiceManager.getOrCreateGuildConfig(guildId).catch(() => null);
  return parseLanguage(config?.lang);
}

export function getMessages(language: BotLanguage): MessageTree {
  return messages.get(parseLanguage(language)) ?? messages.get(DEFAULT_LANGUAGE)!;
}

export async function getGuildMessages(guildId: string | null | undefined): Promise<MessageTree> {
  return getMessages(await getGuildLanguage(guildId));
}

export function t(language: BotLanguage, pathKey: string, values?: InterpolationValues) {
  return interpolate(readPath(getMessages(language), pathKey), values);
}

export async function tg(guildId: string | null | undefined, pathKey: string, values?: InterpolationValues) {
  return t(await getGuildLanguage(guildId), pathKey, values);
}

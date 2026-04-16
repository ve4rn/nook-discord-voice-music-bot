import {
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  DiscordAPIError,
  Guild,
  GuildMember,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  PermissionResolvable,
  SeparatorSpacingSize,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
  VoiceChannel,
  type CacheType,
  type ClientEvents,
  type OverwriteResolvable,
  type VoiceState,
} from "discord.js";
import type App from "./App.js";
import { NookBuilder } from "./NookBuilder.js";
import { prisma } from "./Prisma.js";

type SupportedLanguage = "fr" | "en" | "es" | "de";
type PanelAction = "toggle" | "rename" | "rename_input" | "access";
type PvcInteraction = ButtonInteraction<CacheType> | ModalSubmitInteraction<CacheType> | UserSelectMenuInteraction<CacheType>;
type ParsedCustomId = { action: PanelAction; channelId: string; ownerId: string };
type PanelCreatePayload = { components: NookBuilder[]; flags: typeof MessageFlags.IsComponentsV2 };
type PanelUpdatePayload = { content: null; components: NookBuilder[]; flags: typeof MessageFlags.IsComponentsV2 };

type PrivateVoiceChannel = {
  id: string;
  guildId: string;
  channelId: string;
  ownerId: string;
  isPrivate: boolean;
  allowedIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type PrivateVoiceGuildConfig = {
  id: string;
  guildId: string;
  createChannelId: string;
  categoryId: string;
  enabled: boolean;
  lang: string;
  maxAllowedUsers: number;
  panelMentionTtlMs: number;
  emptyChannelSweepMs: number;
  createdAt: Date;
  updatedAt: Date;
};

type PrivateVoiceGuildConfigUpdate = Partial<Pick<
  PrivateVoiceGuildConfig,
  "createChannelId" | "categoryId" | "enabled" | "lang" | "maxAllowedUsers" | "panelMentionTtlMs" | "emptyChannelSweepMs"
>>;

type PrivateChannelCacheEntry = {
  expiresAt: number;
  value: PrivateVoiceChannel;
};

type TranslationSet = {
  accessPlaceholder: string;
  accessUpdated: string;
  channelNotManaged: string;
  channelRenameSuccess: (newName: string) => string;
  controlPanelIntro: (ownerMention: string) => string;
  createReason: string;
  defaultChannelName: (displayName: string) => string;
  invalidName: string;
  modalTitle: string;
  noLongerExists: string;
  notOwner: string;
  panelDescription: (channelName: string, isPrivate: boolean, allowedCount: number) => string;
  panelFooter: string;
  panelTitle: string;
  privateButton: string;
  privateStatus: string;
  publicButton: string;
  publicStatus: string;
  renameButton: string;
  renameRateLimited: string;
  renameInputLabel: string;
  transferNotice: (ownerMention: string) => string;
  unauthorizedJoin: string;
  updateReason: string;
};

const UNKNOWN_CHANNEL_ERROR = 10_003;
const PLACEHOLDER_CHANNEL_ID = "000000000";
const DEFAULT_ACCENT_COLOR = 0x5165F7;
const PRIVATE_CHANNEL_CACHE_TTL_MS = 5 * 60 * 1000;
const CHANNEL_RENAME_TIMEOUT_MS = 5_000;

const translations: Record<SupportedLanguage, TranslationSet> = {
  fr: {
    accessPlaceholder: "Choisir les membres autorisés",
    accessUpdated: "La liste des membres autorisés à été mise à jour.",
    channelNotManaged: "Ce salon vocal privé n'est plus géré par le bot.",
    channelRenameSuccess: (newName) => `Le salon vocal a ete renommé en **${newName}**.`,
    controlPanelIntro: (ownerMention) => `Panneau de gestion de ${ownerMention}`,
    createReason: "Creation d'un salon vocal privé",
    defaultChannelName: (displayName) => {
      const firstCharacter = displayName.trim().charAt(0).toLowerCase();
      return ["a", "e", "i", "o", "u", "y", "h"].includes(firstCharacter)
        ? `Salon d'${displayName}`
        : `Salon de ${displayName}`;
    },
    invalidName: "Le nom saisi est invalide.",
    modalTitle: "Renommer le salon vocal",
    noLongerExists: "Ce salon vocal privé n'existe plus.",
    notOwner: "Vous n'êtes pas le propriétaire de ce salon vocal privé.",
    panelDescription: (channelName, isPrivate, allowedCount) =>
      `**${channelName}**\n${isPrivate ? "Mode prive activé." : "Mode public activé."}\n${allowedCount} membre(s) actuellement autorise(s) en plus du proprietaire.`,
    panelFooter: "Les changements sont appliqués en direct sur le salon vocal.",
    panelTitle: "Gestion du salon vocal",
    privateButton: "Rendre privé",
    privateStatus: "Seuls les membres autorisés peuvent rejoindre le salon.",
    publicButton: "Rendre public",
    publicStatus: "Tous les membres peuvent rejoindre le salon.",
    renameButton: "Renommer",
    renameRateLimited: "Impossible de renommer le salon pour le moment. Discord limite les renommages de salons par les bots sur une courte période. Réessayez plus tard.",
    renameInputLabel: "Nouveau nom",
    transferNotice: (ownerMention) => `${ownerMention} devient le nouveau propriétaire du salon vocal.`,
    unauthorizedJoin: "Vous n'êtes pas autorisé à rejoindre ce salon vocal privé.",
    updateReason: "Mise à jour des permissions du salon vocal privé",
  },
  en: {
    accessPlaceholder: "Choose allowed members",
    accessUpdated: "The allowed member list has been updated.",
    channelNotManaged: "This private voice channel is no longer managed by the bot.",
    channelRenameSuccess: (newName) => `The voice channel has been renamed to **${newName}**.`,
    controlPanelIntro: (ownerMention) => `${ownerMention}'s control panel`,
    createReason: "Creating a private voice channel",
    defaultChannelName: (displayName) => `${displayName}'s room`,
    invalidName: "The provided name is invalid.",
    modalTitle: "Rename voice channel",
    noLongerExists: "This private voice channel no longer exists.",
    notOwner: "You are not the owner of this private voice channel.",
    panelDescription: (channelName, isPrivate, allowedCount) =>
      `**${channelName}**\n${isPrivate ? "Private mode is enabled." : "Public mode is enabled."}\n${allowedCount} currently allowed member(s) besides the owner.`,
    panelFooter: "Changes are applied live to the voice channel.",
    panelTitle: "Voice Channel Controls",
    privateButton: "Make private",
    privateStatus: "Only allowed members can join this channel.",
    publicButton: "Make public",
    publicStatus: "Everyone can join this channel.",
    renameButton: "Rename",
    renameRateLimited: "I cannot rename this channel right now. Discord limits how often bots can rename channels in a short period. Please try again later.",
    renameInputLabel: "New name",
    transferNotice: (ownerMention) => `${ownerMention} is now the new voice channel owner.`,
    unauthorizedJoin: "You are not allowed to join this private voice channel.",
    updateReason: "Updating private voice channel permissions",
  },
  es: {
    accessPlaceholder: "Elegir miembros autorizados",
    accessUpdated: "La lista de miembros autorizados se ha actualizado.",
    channelNotManaged: "Este canal de voz privado ya no esta gestionado por el bot.",
    channelRenameSuccess: (newName) => `El canal de voz se ha renombrado a **${newName}**.`,
    controlPanelIntro: (ownerMention) => `Panel de gestion de ${ownerMention}`,
    createReason: "Creacion de un canal de voz privado",
    defaultChannelName: (displayName) => `Sala de ${displayName}`,
    invalidName: "El nombre introducido no es valido.",
    modalTitle: "Renombrar el canal de voz",
    noLongerExists: "Este canal de voz privado ya no existe.",
    notOwner: "No eres el propietario de este canal de voz privado.",
    panelDescription: (channelName, isPrivate, allowedCount) =>
      `**${channelName}**\n${isPrivate ? "Modo privado activado." : "Modo publico activado."}\n${allowedCount} miembro(s) autorizado(s) ademas del propietario.`,
    panelFooter: "Los cambios se aplican en directo al canal de voz.",
    panelTitle: "Gestion del canal de voz",
    privateButton: "Hacer privado",
    privateStatus: "Solo los miembros autorizados pueden unirse al canal.",
    publicButton: "Hacer publico",
    publicStatus: "Todos los miembros pueden unirse al canal.",
    renameButton: "Renombrar",
    renameRateLimited: "No puedo renombrar este canal por ahora. Discord limita los cambios de nombre de canales hechos por bots en poco tiempo. Intentalo mas tarde.",
    renameInputLabel: "Nuevo nombre",
    transferNotice: (ownerMention) => `${ownerMention} es ahora el nuevo propietario del canal de voz.`,
    unauthorizedJoin: "No tienes permiso para unirte a este canal de voz privado.",
    updateReason: "Actualizacion de permisos del canal de voz privado",
  },
  de: {
    accessPlaceholder: "Erlaubte Mitglieder auswaehlen",
    accessUpdated: "Die Liste der erlaubten Mitglieder wurde aktualisiert.",
    channelNotManaged: "Dieser private Sprachkanal wird nicht mehr vom Bot verwaltet.",
    channelRenameSuccess: (newName) => `Der Sprachkanal wurde in **${newName}** umbenannt.`,
    controlPanelIntro: (ownerMention) => `Verwaltungspanel von ${ownerMention}`,
    createReason: "Privaten Sprachkanal erstellen",
    defaultChannelName: (displayName) => `${displayName}s Raum`,
    invalidName: "Der eingegebene Name ist ungueltig.",
    modalTitle: "Sprachkanal umbenennen",
    noLongerExists: "Dieser private Sprachkanal existiert nicht mehr.",
    notOwner: "Du bist nicht der Besitzer dieses privaten Sprachkanals.",
    panelDescription: (channelName, isPrivate, allowedCount) =>
      `**${channelName}**\n${isPrivate ? "Privater Modus ist aktiv." : "Oeffentlicher Modus ist aktiv."}\n${allowedCount} zusaetzliche erlaubte(s) Mitglied(er).`,
    panelFooter: "Aenderungen werden direkt auf den Sprachkanal angewendet.",
    panelTitle: "Sprachkanal-Verwaltung",
    privateButton: "Privat machen",
    privateStatus: "Nur erlaubte Mitglieder koennen diesem Kanal beitreten.",
    publicButton: "Oeffentlich machen",
    publicStatus: "Alle Mitglieder koennen diesem Kanal beitreten.",
    renameButton: "Umbenennen",
    renameRateLimited: "Ich kann diesen Kanal gerade nicht umbenennen. Discord begrenzt Kanal-Umbenennungen durch Bots in kurzer Zeit. Bitte versuche es spaeter erneut.",
    renameInputLabel: "Neuer Name",
    transferNotice: (ownerMention) => `${ownerMention} ist jetzt der neue Besitzer des Sprachkanals.`,
    unauthorizedJoin: "Du darfst diesem privaten Sprachkanal nicht beitreten.",
    updateReason: "Berechtigungen des privaten Sprachkanals aktualisieren",
  },
};

const MEMBER_CHANNEL_PERMISSIONS: PermissionResolvable[] = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak,
  PermissionFlagsBits.Stream,
  PermissionFlagsBits.UseVAD,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.AddReactions,
];

const OWNER_CHANNEL_PERMISSIONS: PermissionResolvable[] = [
  ...MEMBER_CHANNEL_PERMISSIONS,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.MuteMembers,
  PermissionFlagsBits.DeafenMembers,
];

const BOT_CHANNEL_PERMISSIONS: PermissionResolvable[] = [
  ...OWNER_CHANNEL_PERMISSIONS,
  PermissionFlagsBits.ManageMessages,
];

function parsePositiveInteger(rawValue: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseLanguage(rawValue: string | null | undefined): SupportedLanguage {
  if (rawValue === "en" || rawValue === "es" || rawValue === "de") return rawValue;
  return "fr";
}

function sanitizeChannelName(input: string): string {
  return input.replace(/\s+/g, " ").trim().slice(0, 100);
}

function composeAllowedIds(ownerId: string, selectedUserIds: string[]): string[] {
  return Array.from(new Set([ownerId, ...selectedUserIds]));
}

function parsePanelCustomId(customId: string): ParsedCustomId | null {
  const [prefix, action, ownerId, channelId] = customId.split(":");
  if (prefix !== "pvc" || !action || !ownerId || !channelId) return null;
  if (!["toggle", "rename", "rename_input", "access"].includes(action)) return null;
  return { action: action as PanelAction, channelId, ownerId };
}

function isManagedVoiceChannel(channel: unknown): channel is VoiceChannel {
  return channel instanceof VoiceChannel && channel.type === ChannelType.GuildVoice;
}

function logError(context: string, error: unknown): void {
  console.error(`[private-voice-manager] ${context}`);
  console.error(error);
}

function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(value), ms);
    timer.unref?.();
  });
}

function createPrivateChannelCacheEntry(value: PrivateVoiceChannel): PrivateChannelCacheEntry {
  return {
    expiresAt: Date.now() + PRIVATE_CHANNEL_CACHE_TTL_MS,
    value,
  };
}

export class PrivateVoiceManager {
  private app: App | null = null;
  private fallbackGuildId: string | null = null;
  private readonly memberLocks = new Map<string, Promise<unknown>>();
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();
  readonly guildConfigCache = new Map<string, PrivateVoiceGuildConfig | null>();
  private readonly privateChannelCache = new Map<string, PrivateChannelCacheEntry>();
  private readonly unmanagedChannelCache = new Set<string>();

  async init(app: App, fallbackGuildId?: string | null) {
    this.app = app;
    this.fallbackGuildId = fallbackGuildId || null;

    await this.bootstrapFallbackConfig();
    await this.preloadCaches();
    await this.reconcileTrackedChannels();
    await this.runStartupCleanupSweeps();
    await this.refreshCleanupTimers();
  }

  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState) {
    if (oldState.channelId === newState.channelId) return;

    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;

    const config = await this.getGuildConfig(newState.guild.id);
    if (!config?.enabled) return;

    await this.withMemberLock(newState.guild.id, member.id, async () => {
      if (newState.channelId === config.createChannelId) {
        const movedBackToOwnedChannel = await this.handleCreateChannelJoin(newState, oldState, config);
        if (movedBackToOwnedChannel) return;
      }

      if (newState.channelId) {
        const joinedTrackedChannel = await this.getPrivateChannelRecord(newState.guild.id, newState.channelId);
        if (joinedTrackedChannel?.isPrivate && !this.isMemberAllowed(member, joinedTrackedChannel)) {
          await member.voice.setChannel(null, "User is not allowed in this private voice channel").catch(error => {
            logError(`failed to remove unauthorized member ${member.id} from ${newState.channelId}`, error);
          });
        }
      }

      if (!oldState.channelId) return;

      const previousPvc = await this.getPrivateChannelRecord(oldState.guild.id, oldState.channelId);
      if (!previousPvc) return;

      const oldChannel = await this.fetchVoiceChannelFromGuild(oldState.guild, oldState.channelId);
    if (!oldChannel) {
        await prisma.privateVoiceChannel.deleteMany({ where: { channelId: oldState.channelId } });
        this.privateChannelCache.delete(oldState.channelId);
        this.unmanagedChannelCache.add(oldState.channelId);
        return;
      }

      if (oldChannel.members.size === 0) {
        await this.removeTrackedChannel(oldChannel.id, "Deleting an empty private voice channel");
        return;
      }

      await this.reassignOwnerIfNeeded(oldChannel, previousPvc, member.id, config);
    });
  }

  async handleChannelDelete(channel: ClientEvents["channelDelete"][0]) {
    if (!isManagedVoiceChannel(channel)) return;
    await prisma.privateVoiceChannel.deleteMany({ where: { channelId: channel.id } });
    this.privateChannelCache.delete(channel.id);
    this.unmanagedChannelCache.delete(channel.id);
  }

  async handleInteraction(interaction: PvcInteraction) {
    const parsed = parsePanelCustomId(interaction.customId);
    if (!parsed) return false;

    try {
      if (interaction.isButton()) await this.handleButtonInteraction(interaction, parsed);
      else if (interaction.isModalSubmit()) await this.handleModalInteraction(interaction, parsed);
      else if (interaction.isUserSelectMenu()) await this.handleUserSelectInteraction(interaction, parsed);
    } catch (error) {
      logError("interactionCreate failed", error);
      await this.replyInteractionError(interaction, this.t(null, "channelNotManaged"));
    }

    return true;
  }

  async setGuildLanguage(guildId: string, language: string) {
    const envCreateChannelId = process.env.PRIVATE_VOICE_CREATE_CHANNEL_ID?.trim();
    const envCategoryId = process.env.PRIVATE_VOICE_CATEGORY_ID?.trim();

    const config = await prisma.privateVoiceGuildConfig.upsert({
      where: { guildId },
      update: { lang: language },
      create: {
        guildId,
        createChannelId: envCreateChannelId || PLACEHOLDER_CHANNEL_ID,
        categoryId: envCategoryId || PLACEHOLDER_CHANNEL_ID,
        enabled: true,
        lang: language,
        maxAllowedUsers: Math.min(parsePositiveInteger(process.env.PVC_MAX_ALLOWED_USERS, 10), 25),
        panelMentionTtlMs: parsePositiveInteger(process.env.PVC_PANEL_MENTION_TTL_MS, 3_000),
        emptyChannelSweepMs: parsePositiveInteger(process.env.PVC_EMPTY_CHANNEL_SWEEP_MS, 60_000),
      },
    });

    this.guildConfigCache.set(guildId, config);
    await this.refreshCleanupTimers();
    return config;
  }

  async getOrCreateGuildConfig(guildId: string) {
    const cached = this.guildConfigCache.get(guildId);
    if (cached) return cached;

    const existing = await prisma.privateVoiceGuildConfig.findUnique({ where: { guildId } });
    if (existing) {
      this.guildConfigCache.set(guildId, existing);
      return existing;
    }

    const envCreateChannelId = process.env.PRIVATE_VOICE_CREATE_CHANNEL_ID?.trim();
    const envCategoryId = process.env.PRIVATE_VOICE_CATEGORY_ID?.trim();
    const config = await prisma.privateVoiceGuildConfig.create({
      data: {
        guildId,
        createChannelId: envCreateChannelId || PLACEHOLDER_CHANNEL_ID,
        categoryId: envCategoryId || PLACEHOLDER_CHANNEL_ID,
        enabled: true,
        lang: parseLanguage(process.env.PVC_LANG),
        maxAllowedUsers: Math.min(parsePositiveInteger(process.env.PVC_MAX_ALLOWED_USERS, 10), 25),
        panelMentionTtlMs: parsePositiveInteger(process.env.PVC_PANEL_MENTION_TTL_MS, 3_000),
        emptyChannelSweepMs: parsePositiveInteger(process.env.PVC_EMPTY_CHANNEL_SWEEP_MS, 60_000),
      },
    });

    this.guildConfigCache.set(guildId, config);
    await this.refreshCleanupTimers();
    return config;
  }

  async updateGuildConfig(guildId: string, data: PrivateVoiceGuildConfigUpdate) {
    await this.getOrCreateGuildConfig(guildId);
    const config = await prisma.privateVoiceGuildConfig.update({
      where: { guildId },
      data,
    });
    this.guildConfigCache.set(guildId, config);
    await this.refreshCleanupTimers();
    return config;
  }

  async deleteGuildData(guildId: string) {
    const timer = this.cleanupTimers.get(guildId);
    if (timer) clearInterval(timer);
    this.cleanupTimers.delete(guildId);
    this.guildConfigCache.delete(guildId);

    for (const [channelId, channel] of this.privateChannelCache) {
      if (channel.value.guildId === guildId) this.privateChannelCache.delete(channelId);
    }

    const [
      currentTracksDetached,
      audioTracks,
      audioStates,
      privateChannels,
      privateConfig,
    ] = await prisma.$transaction([
      prisma.guildAudioState.updateMany({
        where: { guildId },
        data: { currentTrackId: null },
      }),
      prisma.track.deleteMany({ where: { guildId } }),
      prisma.guildAudioState.deleteMany({ where: { guildId } }),
      prisma.privateVoiceChannel.deleteMany({ where: { guildId } }),
      prisma.privateVoiceGuildConfig.deleteMany({ where: { guildId } }),
    ]);

    return {
      currentTracksDetached: currentTracksDetached.count,
      audioTracks: audioTracks.count,
      audioStates: audioStates.count,
      privateChannels: privateChannels.count,
      privateConfig: privateConfig.count,
    };
  }

  private async bootstrapFallbackConfig() {
    if (!this.fallbackGuildId) return;
    const envCreateChannelId = process.env.PRIVATE_VOICE_CREATE_CHANNEL_ID?.trim();
    const envCategoryId = process.env.PRIVATE_VOICE_CATEGORY_ID?.trim();
    const hasEnvVoiceConfig = Boolean(envCreateChannelId && envCategoryId);
    const createChannelId = envCreateChannelId || PLACEHOLDER_CHANNEL_ID;
    const categoryId = envCategoryId || PLACEHOLDER_CHANNEL_ID;

    const config = await prisma.privateVoiceGuildConfig.upsert({
      where: { guildId: this.fallbackGuildId },
      update: hasEnvVoiceConfig ? {
        createChannelId: envCreateChannelId!,
        categoryId: envCategoryId!,
        enabled: true,
        maxAllowedUsers: Math.min(parsePositiveInteger(process.env.PVC_MAX_ALLOWED_USERS, 10), 25),
        panelMentionTtlMs: parsePositiveInteger(process.env.PVC_PANEL_MENTION_TTL_MS, 3_000),
        emptyChannelSweepMs: parsePositiveInteger(process.env.PVC_EMPTY_CHANNEL_SWEEP_MS, 60_000),
      } : {},
      create: {
        guildId: this.fallbackGuildId,
        createChannelId,
        categoryId,
        enabled: true,
        lang: parseLanguage(process.env.PVC_LANG),
        maxAllowedUsers: Math.min(parsePositiveInteger(process.env.PVC_MAX_ALLOWED_USERS, 10), 25),
        panelMentionTtlMs: parsePositiveInteger(process.env.PVC_PANEL_MENTION_TTL_MS, 3_000),
        emptyChannelSweepMs: parsePositiveInteger(process.env.PVC_EMPTY_CHANNEL_SWEEP_MS, 60_000),
      },
    });
    this.guildConfigCache.set(this.fallbackGuildId, config);
  }

  private async getGuildConfig(guildId: string) {
    if (this.guildConfigCache.has(guildId)) return this.guildConfigCache.get(guildId) ?? null;
    let config = await prisma.privateVoiceGuildConfig.findUnique({ where: { guildId } });
    if (!config && guildId === this.fallbackGuildId) {
      await this.bootstrapFallbackConfig();
      config = this.guildConfigCache.get(guildId) ?? null;
    }
    this.guildConfigCache.set(guildId, config);
    return config;
  }

  private async preloadCaches() {
    const configs = await prisma.privateVoiceGuildConfig.findMany();
    this.guildConfigCache.clear();
    for (const config of configs) this.guildConfigCache.set(config.guildId, config);

    const privateChannels = await prisma.privateVoiceChannel.findMany();
    this.privateChannelCache.clear();
    this.unmanagedChannelCache.clear();
    for (const channel of privateChannels) this.cachePrivateChannel(channel);
  }

  private async getPrivateChannelRecord(guildId: string, channelId: string | null) {
    if (!channelId) return null;

    const cached = this.privateChannelCache.get(channelId);
    if (cached && cached.expiresAt > Date.now()) return cached.value.guildId === guildId ? cached.value : null;
    if (cached) this.privateChannelCache.delete(channelId);
    if (this.unmanagedChannelCache.has(channelId)) return null;

    const pvc = await prisma.privateVoiceChannel.findUnique({ where: { channelId } });
    if (!pvc) {
      this.unmanagedChannelCache.add(channelId);
      return null;
    }

    this.cachePrivateChannel(pvc);
    return pvc.guildId === guildId ? pvc : null;
  }

  private async getPrivateChannelRecordById(channelId: string | null) {
    if (!channelId) return null;

    const cached = this.privateChannelCache.get(channelId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.privateChannelCache.delete(channelId);
    if (this.unmanagedChannelCache.has(channelId)) return null;

    const pvc = await prisma.privateVoiceChannel.findUnique({ where: { channelId } });
    if (!pvc) {
      this.unmanagedChannelCache.add(channelId);
      return null;
    }

    this.cachePrivateChannel(pvc);
    return pvc;
  }

  private cachePrivateChannel(channel: PrivateVoiceChannel) {
    this.privateChannelCache.set(channel.channelId, createPrivateChannelCacheEntry(channel));
    this.unmanagedChannelCache.delete(channel.channelId);
  }

  private getCachedPrivateChannels() {
    const now = Date.now();
    const channels: PrivateVoiceChannel[] = [];
    for (const [channelId, entry] of this.privateChannelCache.entries()) {
      if (entry.expiresAt <= now) {
        this.privateChannelCache.delete(channelId);
        continue;
      }
      channels.push(entry.value);
    }
    return channels;
  }

  private t(config: PrivateVoiceGuildConfig | null, key: keyof TranslationSet, ...args: unknown[]): string {
    const lang = parseLanguage(config?.lang);
    const entry = translations[lang][key] as string | ((...input: unknown[]) => string);
    return typeof entry === "function" ? entry(...args) : entry;
  }

  private async withMemberLock<T>(guildId: string, memberId: string, task: () => Promise<T>): Promise<T> {
    const key = `${guildId}:${memberId}`;
    const previous = this.memberLocks.get(key) ?? Promise.resolve();
    let releaseCurrent!: () => void;
    const gate = new Promise<void>(resolve => {
      releaseCurrent = resolve;
    });
    const current = previous.catch(() => undefined).then(() => gate);

    this.memberLocks.set(key, current);
    await previous.catch(() => undefined);

    try {
      return await task();
    } finally {
      releaseCurrent();
      if (this.memberLocks.get(key) === current) this.memberLocks.delete(key);
    }
  }

  private async fetchVoiceChannelFromGuild(guild: Guild, channelId: string): Promise<VoiceChannel | null> {
    const cached = guild.channels.cache.get(channelId);
    if (isManagedVoiceChannel(cached)) return cached;

    try {
      const fetched = await guild.channels.fetch(channelId);
      return isManagedVoiceChannel(fetched) ? fetched : null;
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === UNKNOWN_CHANNEL_ERROR) return null;
      throw error;
    }
  }

  private async safelyDeleteChannel(channel: VoiceChannel, reason: string): Promise<void> {
    try {
      await channel.delete(reason);
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === UNKNOWN_CHANNEL_ERROR) return;
      throw error;
    }
  }

  private async removeTrackedChannel(channelId: string, reason: string): Promise<void> {
    if (!this.app) return;
    const channel = await this.app.channels.fetch(channelId).catch((error: unknown) => {
      if (error instanceof DiscordAPIError && error.code === UNKNOWN_CHANNEL_ERROR) return null;
      throw error;
    });

    if (isManagedVoiceChannel(channel)) await this.safelyDeleteChannel(channel, reason);
    await prisma.privateVoiceChannel.deleteMany({ where: { channelId } });
    this.privateChannelCache.delete(channelId);
    this.unmanagedChannelCache.add(channelId);
  }

  private async renameVoiceChannel(channel: VoiceChannel, requestedName: string, reason: string) {
    const renameTask = channel.setName(requestedName, reason)
      .then(() => true)
      .catch((error: unknown) => {
        logError(`failed to rename private voice channel ${channel.id} to ${requestedName}`, error);
        return false;
      });

    const renameFinished = await Promise.race([
      renameTask,
      timeout(CHANNEL_RENAME_TIMEOUT_MS, false),
    ]);
    if (!renameFinished) return false;

    const updatedChannel = await Promise.race([
      channel.guild.channels.fetch(channel.id, { force: true, cache: true }).catch((error: unknown) => {
        logError(`failed to refetch private voice channel ${channel.id} after rename`, error);
        return null;
      }),
      timeout(CHANNEL_RENAME_TIMEOUT_MS, null),
    ]);

    return isManagedVoiceChannel(updatedChannel) && updatedChannel.name === requestedName;
  }

  private isMemberAllowed(member: GuildMember, pvc: PrivateVoiceChannel): boolean {
    if (member.id === pvc.ownerId) return true;
    if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
    return !pvc.isPrivate || pvc.allowedIds.includes(member.id);
  }

  private resolveMemberAccentColor(member: GuildMember): number {
    const coloredRole = member.roles.cache
      .sort((left, right) => right.position - left.position)
      .find(role => role.colors.primaryColor > 0);
    return coloredRole?.colors.primaryColor ?? DEFAULT_ACCENT_COLOR;
  }

  private async syncChannelPermissions(guild: Guild, channel: VoiceChannel, pvc: PrivateVoiceChannel, config: PrivateVoiceGuildConfig) {
    const botUserId = guild.client.user?.id;
    if (!botUserId) throw new Error("Bot user is not available.");

    const overwrites: OverwriteResolvable[] = [
      {
        id: guild.roles.everyone.id,
        allow: pvc.isPrivate ? [] : MEMBER_CHANNEL_PERMISSIONS,
        deny: pvc.isPrivate ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] : [],
      },
      { id: pvc.ownerId, allow: OWNER_CHANNEL_PERMISSIONS },
      { id: botUserId, allow: BOT_CHANNEL_PERMISSIONS },
    ];

    if (pvc.isPrivate) {
      for (const allowedId of pvc.allowedIds) {
        if (allowedId !== pvc.ownerId) overwrites.push({ id: allowedId, allow: MEMBER_CHANNEL_PERMISSIONS });
      }
    }

    await channel.permissionOverwrites.set(overwrites, this.t(config, "updateReason"));
  }

  private buildPanelContainer(owner: GuildMember, pvc: PrivateVoiceChannel, channelName: string, config: PrivateVoiceGuildConfig) {
    const allowedCount = Math.max(pvc.allowedIds.filter(id => id !== pvc.ownerId).length, 0);
    const container = new NookBuilder()
      .setAccentColor(this.resolveMemberAccentColor(owner))
      .addTextDisplayComponents(text => text.setContent(`## ${this.t(config, "panelTitle")}\n${this.t(config, "controlPanelIntro", owner.toString())}`))
      .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addSectionComponents(section =>
        section
          .addTextDisplayComponents(text =>
            text.setContent(`${this.t(config, "panelDescription", channelName, pvc.isPrivate, allowedCount)}\n> ${pvc.isPrivate ? this.t(config, "privateStatus") : this.t(config, "publicStatus")}`),
          )
          .setButtonAccessory(button =>
            button
              .setCustomId(`pvc:toggle:${pvc.ownerId}:${pvc.channelId}`)
              .setLabel(pvc.isPrivate ? this.t(config, "publicButton") : this.t(config, "privateButton"))
              .setStyle(pvc.isPrivate ? ButtonStyle.Success : ButtonStyle.Secondary),
          ),
      )
      .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addSectionComponents(section =>
        section
          .addTextDisplayComponents(text => text.setContent(this.t(config, "panelFooter")))
          .setButtonAccessory(button =>
            button
              .setCustomId(`pvc:rename:${pvc.ownerId}:${pvc.channelId}`)
              .setLabel(this.t(config, "renameButton"))
              .setStyle(ButtonStyle.Primary),
          ),
      );

    if (pvc.isPrivate) {
      container
        .addSeparatorComponents(separator => separator.setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(row =>
          row.addComponents(
            new UserSelectMenuBuilder()
              .setCustomId(`pvc:access:${pvc.ownerId}:${pvc.channelId}`)
              .setPlaceholder(this.t(config, "accessPlaceholder"))
              .setMinValues(0)
              .setMaxValues(Math.min(Math.max(config.maxAllowedUsers, 1), 25))
              .setDefaultUsers(pvc.allowedIds.filter(id => id !== pvc.ownerId)),
          ),
        );
    }

    return container;
  }

  private buildControlPanelCreateMessage(owner: GuildMember, pvc: PrivateVoiceChannel, channelName: string, config: PrivateVoiceGuildConfig): PanelCreatePayload {
    return { components: [this.buildPanelContainer(owner, pvc, channelName, config)], flags: MessageFlags.IsComponentsV2 };
  }

  private buildControlPanelUpdateMessage(owner: GuildMember, pvc: PrivateVoiceChannel, channelName: string, config: PrivateVoiceGuildConfig): PanelUpdatePayload {
    return { content: null, components: [this.buildPanelContainer(owner, pvc, channelName, config)], flags: MessageFlags.IsComponentsV2 };
  }

  private async sendManagedChannelMessage(channel: VoiceChannel, payload: string | Parameters<VoiceChannel["send"]>[0]) {
    if (!channel.isSendable()) return;
    await channel.send(payload).catch(error => logError(`failed to send a message in voice channel ${channel.id}`, error));
  }

  private async sendOwnerGreeting(channel: VoiceChannel, owner: GuildMember, config: PrivateVoiceGuildConfig) {
    if (!channel.isSendable()) return;
    const pingMessage = await channel.send({ content: owner.toString() }).catch(error => {
      logError(`failed to send greeting in voice channel ${channel.id}`, error);
      return null;
    });
    if (!pingMessage) return;
    setTimeout(() => void pingMessage.delete().catch(() => undefined), config.panelMentionTtlMs).unref?.();
  }

  private async createPrivateVoiceChannel(guild: Guild, owner: GuildMember, config: PrivateVoiceGuildConfig) {
    const category = guild.channels.cache.get(config.categoryId) ?? await guild.channels.fetch(config.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new Error(`Configured category ${config.categoryId} was not found or is not a category.`);
    }

    const channelName = sanitizeChannelName(translations[parseLanguage(config.lang)].defaultChannelName(owner.displayName));
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
        { id: owner.id, allow: OWNER_CHANNEL_PERMISSIONS },
        { id: guild.client.user!.id, allow: BOT_CHANNEL_PERMISSIONS },
      ],
      reason: this.t(config, "createReason"),
    });

    try {
      const pvc = await prisma.privateVoiceChannel.create({
        data: {
          guildId: guild.id,
          allowedIds: [owner.id],
          channelId: channel.id,
          isPrivate: true,
          ownerId: owner.id,
        },
      });

      this.cachePrivateChannel(pvc);
      await this.syncChannelPermissions(guild, channel, pvc, config);
      return { channel, pvc };
    } catch (error) {
      await this.safelyDeleteChannel(channel, "Rolling back failed private voice channel creation").catch(() => undefined);
      throw error;
    }
  }

  private async findReusablePrivateChannel(guild: Guild, ownerId: string) {
    const trackedChannels = this.getCachedPrivateChannels()
      .filter(channel => channel.guildId === guild.id && channel.ownerId === ownerId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    const staleChannelIds: string[] = [];
    for (const pvc of trackedChannels) {
      const channel = await this.fetchVoiceChannelFromGuild(guild, pvc.channelId);
      if (!channel) {
        staleChannelIds.push(pvc.channelId);
        continue;
      }
      return { channel, pvc };
    }

    if (staleChannelIds.length > 0) {
      await prisma.privateVoiceChannel.deleteMany({ where: { channelId: { in: staleChannelIds } } });
      for (const channelId of staleChannelIds) {
        this.privateChannelCache.delete(channelId);
        this.unmanagedChannelCache.add(channelId);
      }
    }
    return null;
  }

  private async publishControlPanel(channel: VoiceChannel, owner: GuildMember, pvc: PrivateVoiceChannel, config: PrivateVoiceGuildConfig) {
    await this.sendManagedChannelMessage(channel, this.buildControlPanelCreateMessage(owner, pvc, channel.name, config));
    await this.sendOwnerGreeting(channel, owner, config);
  }

  private async handleCreateChannelJoin(newState: VoiceState, oldState: VoiceState, config: PrivateVoiceGuildConfig): Promise<boolean> {
    const member = newState.member;
    if (!member) return false;

    const reused = await this.findReusablePrivateChannel(newState.guild, member.id);
    if (reused) {
      await member.voice.setChannel(reused.channel);
      return oldState.channelId === reused.channel.id;
    }

    const created = await this.createPrivateVoiceChannel(newState.guild, member, config);
    await member.voice.setChannel(created.channel);
    await this.publishControlPanel(created.channel, member, created.pvc, config);
    return false;
  }

  private async reassignOwnerIfNeeded(channel: VoiceChannel, pvc: PrivateVoiceChannel, leavingMemberId: string, config: PrivateVoiceGuildConfig) {
    if (pvc.ownerId !== leavingMemberId || channel.members.size === 0) return;

    const nextOwner = channel.members.find(member => !member.user.bot);
    if (!nextOwner) return;

    const updated = await prisma.privateVoiceChannel.update({
      where: { channelId: channel.id },
      data: {
        allowedIds: composeAllowedIds(nextOwner.id, pvc.allowedIds),
        ownerId: nextOwner.id,
      },
    });

    this.cachePrivateChannel(updated);
    await this.syncChannelPermissions(channel.guild, channel, updated, config);
    await this.sendManagedChannelMessage(channel, { content: this.t(config, "transferNotice", nextOwner.toString()) });
    await this.publishControlPanel(channel, nextOwner, updated, config);
  }

  private async getTrackedChannel(guild: Guild, channelId: string) {
    const pvc = await this.getPrivateChannelRecord(guild.id, channelId);
    if (!pvc) return null;

    const channel = await this.fetchVoiceChannelFromGuild(guild, channelId);
    if (!channel) {
      await prisma.privateVoiceChannel.deleteMany({ where: { channelId } });
      this.privateChannelCache.delete(channelId);
      this.unmanagedChannelCache.add(channelId);
      return null;
    }

    const config = await this.getGuildConfig(guild.id);
    if (!config) return null;

    return { channel, config, pvc };
  }

  private async ensureOwnerInteraction(interaction: PvcInteraction, ownerId: string, config: PrivateVoiceGuildConfig): Promise<GuildMember | null> {
    const member = interaction.member instanceof GuildMember ? interaction.member : null;
    if (!member) return null;

    if (member.id !== ownerId) {
      if (interaction.isModalSubmit()) await interaction.editReply({ content: this.t(config, "notOwner") }).catch(() => undefined);
      else await interaction.reply({ content: this.t(config, "notOwner"), flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return null;
    }

    return member;
  }

  private async handleButtonInteraction(interaction: ButtonInteraction<CacheType>, parsed: ParsedCustomId) {
    const guild = interaction.guild;
    if (!guild) return;

    const tracked = await this.getTrackedChannel(guild, parsed.channelId);
    if (!tracked) {
      await interaction.reply({ content: this.t(null, "noLongerExists"), flags: MessageFlags.Ephemeral });
      return;
    }

    const owner = await this.ensureOwnerInteraction(interaction, parsed.ownerId, tracked.config);
    if (!owner) return;

    if (parsed.action === "rename") {
      const modal = new ModalBuilder()
        .setCustomId(`pvc:rename_input:${parsed.ownerId}:${parsed.channelId}`)
        .setTitle(this.t(tracked.config, "modalTitle"));
      const input = new TextInputBuilder()
        .setCustomId("name")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100)
        .setStyle(TextInputStyle.Short)
        .setValue(tracked.channel.name);

      modal.addLabelComponents(new LabelBuilder().setLabel(this.t(tracked.config, "renameInputLabel")).setTextInputComponent(input));
      await interaction.showModal(modal);
      return;
    }

    const updated = await prisma.privateVoiceChannel.update({
      where: { channelId: parsed.channelId },
      data: { isPrivate: !tracked.pvc.isPrivate },
    });

    this.cachePrivateChannel(updated);
    await this.syncChannelPermissions(guild, tracked.channel, updated, tracked.config);
    await interaction.update(this.buildControlPanelUpdateMessage(owner, updated, tracked.channel.name, tracked.config));
  }

  private async handleModalInteraction(interaction: ModalSubmitInteraction<CacheType>, parsed: ParsedCustomId) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guild = interaction.guild;
    if (!guild) return;

    const tracked = await this.getTrackedChannel(guild, parsed.channelId);
    if (!tracked) {
      await interaction.editReply({ content: this.t(null, "noLongerExists") });
      return;
    }

    const owner = await this.ensureOwnerInteraction(interaction, parsed.ownerId, tracked.config);
    if (!owner) return;

    const requestedName = sanitizeChannelName(interaction.fields.getTextInputValue("name"));
    if (!requestedName) {
      await interaction.editReply({ content: this.t(tracked.config, "invalidName") });
      return;
    }

    const renamed = await this.renameVoiceChannel(tracked.channel, requestedName, this.t(tracked.config, "updateReason"));
    if (!renamed) {
      await interaction.editReply({ content: this.t(tracked.config, "renameRateLimited") });
      return;
    }

    await interaction.editReply({ content: this.t(tracked.config, "channelRenameSuccess", requestedName) });
  }

  private async handleUserSelectInteraction(interaction: UserSelectMenuInteraction<CacheType>, parsed: ParsedCustomId) {
    const guild = interaction.guild;
    if (!guild) return;

    const tracked = await this.getTrackedChannel(guild, parsed.channelId);
    if (!tracked) {
      await interaction.reply({ content: this.t(null, "noLongerExists"), flags: MessageFlags.Ephemeral });
      return;
    }

    const owner = await this.ensureOwnerInteraction(interaction, parsed.ownerId, tracked.config);
    if (!owner) return;

    await interaction.deferUpdate();

    const allowedIds = composeAllowedIds(parsed.ownerId, interaction.values.slice(0, tracked.config.maxAllowedUsers));
    const updated = await prisma.privateVoiceChannel.update({
      where: { channelId: parsed.channelId },
      data: { allowedIds },
    });

    this.cachePrivateChannel(updated);
    await this.syncChannelPermissions(guild, tracked.channel, updated, tracked.config);
    await interaction.message.edit(this.buildControlPanelUpdateMessage(owner, updated, tracked.channel.name, tracked.config)).catch(error => {
      logError(`failed to refresh control panel for channel ${tracked.channel.id}`, error);
    });
    await interaction.followUp({ content: this.t(tracked.config, "accessUpdated"), flags: MessageFlags.Ephemeral });
  }

  private async cleanupIfEmpty(channelId: string) {
    const pvc = await this.getPrivateChannelRecordById(channelId);
    if (!pvc || !this.app) return;

    const channel = await this.app.channels.fetch(channelId).catch((error: unknown) => {
      if (error instanceof DiscordAPIError && error.code === UNKNOWN_CHANNEL_ERROR) return null;
      throw error;
    });

    if (!channel || !isManagedVoiceChannel(channel)) {
      await prisma.privateVoiceChannel.deleteMany({ where: { channelId } });
      this.privateChannelCache.delete(channelId);
      this.unmanagedChannelCache.add(channelId);
      return;
    }

    if (channel.members.size > 0) return;

    await this.safelyDeleteChannel(channel, "Deleting an empty private voice channel");
    await prisma.privateVoiceChannel.deleteMany({ where: { channelId } });
    this.privateChannelCache.delete(channelId);
    this.unmanagedChannelCache.add(channelId);
  }

  private async runCleanupSweep(guildId: string) {
    const trackedChannels = this.getCachedPrivateChannels().filter(channel => channel.guildId === guildId);
    for (const pvc of trackedChannels) {
      await this.cleanupIfEmpty(pvc.channelId).catch(error => logError(`cleanup sweep failed for channel ${pvc.channelId}`, error));
    }
  }

  private getKnownCleanupGuildIds() {
    const guildIds = new Set<string>();

    for (const [guildId, config] of this.guildConfigCache) {
      if (config) guildIds.add(guildId);
    }

    for (const channel of this.getCachedPrivateChannels()) {
      guildIds.add(channel.guildId);
    }

    return Array.from(guildIds);
  }

  private async runStartupCleanupSweeps() {
    const guildIds = this.getKnownCleanupGuildIds();
    for (const guildId of guildIds) {
      await this.runCleanupSweep(guildId).catch(error => {
        logError(`startup cleanup sweep failed for guild ${guildId}`, error);
      });
    }
  }

  private async reconcileTrackedChannels() {
    if (!this.app) return;
    const trackedChannels = this.getCachedPrivateChannels();

    for (const pvc of trackedChannels) {
      const config = await this.getGuildConfig(pvc.guildId);
      const channel = await this.app.channels.fetch(pvc.channelId).catch((error: unknown) => {
        if (error instanceof DiscordAPIError && error.code === UNKNOWN_CHANNEL_ERROR) return null;
        throw error;
      });

      if (!channel || !isManagedVoiceChannel(channel)) {
        await prisma.privateVoiceChannel.deleteMany({ where: { channelId: pvc.channelId } });
        this.privateChannelCache.delete(pvc.channelId);
        this.unmanagedChannelCache.add(pvc.channelId);
        continue;
      }

      if (channel.members.size === 0) {
        await this.removeTrackedChannel(channel.id, "Deleting an empty private voice channel during startup");
        continue;
      }

      if (config) {
        await this.syncChannelPermissions(channel.guild, channel, pvc, config).catch(error => {
          logError(`failed to resync permissions for ${channel.id}`, error);
        });
      }
    }
  }

  private async refreshCleanupTimers() {
    for (const timer of this.cleanupTimers.values()) clearInterval(timer);
    this.cleanupTimers.clear();

    const configs = Array.from(this.guildConfigCache.values()).filter(config => config?.enabled) as PrivateVoiceGuildConfig[];
    for (const config of configs) {
      const timer = setInterval(() => {
        void this.runCleanupSweep(config.guildId).catch(error => {
          logError(`periodic cleanup sweep failed for guild ${config.guildId}`, error);
        });
      }, config.emptyChannelSweepMs);
      timer.unref?.();
      this.cleanupTimers.set(config.guildId, timer);
    }
  }

  private async replyInteractionError(interaction: PvcInteraction, content: string) {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
      return;
    }

    await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => undefined);
  }
}

export const privateVoiceManager = new PrivateVoiceManager();

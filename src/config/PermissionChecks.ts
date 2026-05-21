import {
  ChannelType,
  Guild,
  GuildBasedChannel,
  GuildMember,
  PermissionFlagsBits,
  PermissionsBitField,
  TextChannel,
  VoiceChannel,
} from "discord.js";

export type PermissionLanguage = "fr" | "en" | "es" | "de";

type PermissionRequirement = {
  flag: bigint;
  key: PermissionKey;
};

export type PermissionKey =
  | "ViewChannel"
  | "SendMessages"
  | "ReadMessageHistory"
  | "EmbedLinks"
  | "AttachFiles"
  | "ManageMessages"
  | "ManageChannels"
  | "MoveMembers"
  | "Connect"
  | "Speak"
  | "UseVAD"
  | "Stream";

export type PermissionCheckResult = {
  ok: boolean;
  missing: PermissionKey[];
};

export const MESSAGE_PERMISSIONS: PermissionRequirement[] = [
  { key: "ViewChannel", flag: PermissionFlagsBits.ViewChannel },
  { key: "SendMessages", flag: PermissionFlagsBits.SendMessages },
  { key: "ReadMessageHistory", flag: PermissionFlagsBits.ReadMessageHistory },
];

export const COMPONENT_MESSAGE_PERMISSIONS: PermissionRequirement[] = [
  ...MESSAGE_PERMISSIONS,
  { key: "EmbedLinks", flag: PermissionFlagsBits.EmbedLinks },
  { key: "AttachFiles", flag: PermissionFlagsBits.AttachFiles },
];

export const VOICE_CREATE_PERMISSIONS: PermissionRequirement[] = [
  { key: "ViewChannel", flag: PermissionFlagsBits.ViewChannel },
  { key: "ManageChannels", flag: PermissionFlagsBits.ManageChannels },
];

export const VOICE_MOVE_PERMISSIONS: PermissionRequirement[] = [
  { key: "ViewChannel", flag: PermissionFlagsBits.ViewChannel },
  { key: "Connect", flag: PermissionFlagsBits.Connect },
  { key: "MoveMembers", flag: PermissionFlagsBits.MoveMembers },
];

export const AUDIO_VOICE_PERMISSIONS: PermissionRequirement[] = [
  { key: "ViewChannel", flag: PermissionFlagsBits.ViewChannel },
  { key: "Connect", flag: PermissionFlagsBits.Connect },
  { key: "Speak", flag: PermissionFlagsBits.Speak },
];

export const VOICE_MEMBER_PERMISSIONS: PermissionRequirement[] = [
  { key: "ViewChannel", flag: PermissionFlagsBits.ViewChannel },
  { key: "Connect", flag: PermissionFlagsBits.Connect },
  { key: "Speak", flag: PermissionFlagsBits.Speak },
  { key: "Stream", flag: PermissionFlagsBits.Stream },
  { key: "UseVAD", flag: PermissionFlagsBits.UseVAD },
  { key: "SendMessages", flag: PermissionFlagsBits.SendMessages },
  { key: "ReadMessageHistory", flag: PermissionFlagsBits.ReadMessageHistory },
  { key: "EmbedLinks", flag: PermissionFlagsBits.EmbedLinks },
  { key: "AttachFiles", flag: PermissionFlagsBits.AttachFiles },
  { key: "ManageMessages", flag: PermissionFlagsBits.ManageMessages },
];

const labels: Record<PermissionLanguage, Record<PermissionKey, string>> = {
  fr: {
    ViewChannel: "Voir les salons",
    SendMessages: "Envoyer des messages",
    ReadMessageHistory: "Lire l'historique des messages",
    EmbedLinks: "Integrer des liens",
    AttachFiles: "Joindre des fichiers",
    ManageMessages: "Gerer les messages",
    ManageChannels: "Gerer les salons",
    MoveMembers: "Deplacer des membres",
    Connect: "Se connecter",
    Speak: "Parler",
    UseVAD: "Utiliser la detection vocale",
    Stream: "Video",
  },
  en: {
    ViewChannel: "View Channels",
    SendMessages: "Send Messages",
    ReadMessageHistory: "Read Message History",
    EmbedLinks: "Embed Links",
    AttachFiles: "Attach Files",
    ManageMessages: "Manage Messages",
    ManageChannels: "Manage Channels",
    MoveMembers: "Move Members",
    Connect: "Connect",
    Speak: "Speak",
    UseVAD: "Use Voice Activity",
    Stream: "Video",
  },
  es: {
    ViewChannel: "Ver canales",
    SendMessages: "Enviar mensajes",
    ReadMessageHistory: "Leer el historial de mensajes",
    EmbedLinks: "Insertar enlaces",
    AttachFiles: "Adjuntar archivos",
    ManageMessages: "Gestionar mensajes",
    ManageChannels: "Gestionar canales",
    MoveMembers: "Mover miembros",
    Connect: "Conectar",
    Speak: "Hablar",
    UseVAD: "Usar actividad de voz",
    Stream: "Video",
  },
  de: {
    ViewChannel: "Kanaele ansehen",
    SendMessages: "Nachrichten senden",
    ReadMessageHistory: "Nachrichtenverlauf lesen",
    EmbedLinks: "Links einbetten",
    AttachFiles: "Dateien anhaengen",
    ManageMessages: "Nachrichten verwalten",
    ManageChannels: "Kanaele verwalten",
    MoveMembers: "Mitglieder verschieben",
    Connect: "Verbinden",
    Speak: "Sprechen",
    UseVAD: "Sprachaktivierung verwenden",
    Stream: "Video",
  },
};

function uniqueKeys(keys: PermissionKey[]) {
  return Array.from(new Set(keys));
}

function resolveBotMember(guild: Guild) {
  return guild.members.me ?? null;
}

function checkPermissions(
  permissions: Readonly<PermissionsBitField> | null,
  requirements: PermissionRequirement[],
): PermissionCheckResult {
  const missing = requirements
    .filter(requirement => !permissions?.has(requirement.flag))
    .map(requirement => requirement.key);

  return { ok: missing.length === 0, missing: uniqueKeys(missing) };
}

export function permissionLabels(language: PermissionLanguage, missing: PermissionKey[]) {
  const localizedLabels = labels[language] ?? labels.fr;
  return uniqueKeys(missing).map(key => localizedLabels[key] ?? key);
}

export function discordPermissionNames(missing: PermissionKey[]) {
  return uniqueKeys(missing).map(key => labels.en[key] ?? key);
}

export function permissionLabel(language: PermissionLanguage, key: PermissionKey) {
  return permissionLabels(language, [key])[0] ?? key;
}

export function formatPermissionList(language: PermissionLanguage, missing: PermissionKey[]) {
  return permissionLabels(language, missing).map(label => `- ${label}`).join("\n");
}

export function formatDiscordPermissionInline(missing: PermissionKey[]) {
  return discordPermissionNames(missing).map(name => `\`${name}\``).join(", ");
}

export function formatDiscordPermissionList(missing: PermissionKey[]) {
  return discordPermissionNames(missing).map(name => `- \`${name}\``).join("\n");
}

export function checkCanSendText(channel: GuildBasedChannel) {
  const bot = resolveBotMember(channel.guild);
  return checkPermissions(bot ? channel.permissionsFor(bot) : null, MESSAGE_PERMISSIONS);
}

export function checkCanSendComponents(channel: GuildBasedChannel) {
  const bot = resolveBotMember(channel.guild);
  return checkPermissions(bot ? channel.permissionsFor(bot) : null, COMPONENT_MESSAGE_PERMISSIONS);
}

export function checkCanCreateVoiceInCategory(guild: Guild, category: GuildBasedChannel | null) {
  if (!category || category.type !== ChannelType.GuildCategory) {
    return { ok: false, missing: ["ManageChannels"] as PermissionKey[] };
  }

  const bot = resolveBotMember(guild);
  return checkPermissions(bot ? category.permissionsFor(bot) : null, VOICE_CREATE_PERMISSIONS);
}

export function checkCanManageVoiceChannel(channel: VoiceChannel) {
  const bot = resolveBotMember(channel.guild);
  return checkPermissions(bot ? channel.permissionsFor(bot) : null, [
    { key: "ViewChannel", flag: PermissionFlagsBits.ViewChannel },
    { key: "ManageChannels", flag: PermissionFlagsBits.ManageChannels },
  ]);
}

export function checkCanMoveMemberToVoice(member: GuildMember, channel: VoiceChannel) {
  const bot = resolveBotMember(channel.guild);
  void member;
  return checkPermissions(bot ? channel.permissionsFor(bot) : null, VOICE_MOVE_PERMISSIONS);
}

export function checkCanUseVoiceForAudio(channel: GuildBasedChannel) {
  const bot = resolveBotMember(channel.guild);
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    return { ok: false, missing: ["ViewChannel", "Connect", "Speak"] as PermissionKey[] };
  }
  return checkPermissions(bot ? channel.permissionsFor(bot) : null, AUDIO_VOICE_PERMISSIONS);
}

export function checkVoiceChannelAccess(channel: VoiceChannel) {
  const bot = resolveBotMember(channel.guild);
  return checkPermissions(bot ? channel.permissionsFor(bot) : null, VOICE_MEMBER_PERMISSIONS);
}

function canEveryoneReadAndWrite(channel: TextChannel) {
  const everyonePerms = channel.permissionsFor(channel.guild.roles.everyone);
  const botPerms = channel.guild.members.me ? channel.permissionsFor(channel.guild.members.me) : null;
  return Boolean(
    everyonePerms?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ])
    && botPerms?.has([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ]),
  );
}

export function comparePublicTextChannels(left: TextChannel, right: TextChannel) {
  return left.position - right.position
    || left.rawPosition - right.rawPosition
    || left.id.localeCompare(right.id);
}

export async function findFirstPublicWritableTextChannel(guild: Guild) {
  await guild.channels.fetch().catch(() => null);
  const candidates = guild.channels.cache.filter((channel): channel is TextChannel =>
    channel.type === ChannelType.GuildText && canEveryoneReadAndWrite(channel),
  );

  return candidates.reduce<TextChannel | null>((bestChannel, channel) => {
    if (!bestChannel) return channel;
    return comparePublicTextChannels(channel, bestChannel) < 0 ? channel : bestChannel;
  }, null);
}

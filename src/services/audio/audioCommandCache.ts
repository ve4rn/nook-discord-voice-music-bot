import { getGuildLanguage, getMessages, tp, type BotLanguage } from "../../config/i18n.js";
import { permissionLabel, type PermissionLanguage } from "../../config/PermissionChecks.js";
import { getAudioUserErrorMessage } from "./AudioErrorMapper.js";

export type AudioCommandCopy = {
  serverOnly: string;
  emptyQueue: string;
  noCurrentTrack: string;
  voteSkip: (votes: number, needed: number) => string;
  votePrevious: (votes: number, needed: number) => string;
  panel: {
    queueTitle: string;
    unknownAuthor: string;
    queuedTitle: string;
    playingTitle: string;
  };
  controls: {
    guildMismatch: string;
    playerNotReady: string;
    noNextTrack: string;
    noPreviousTrack: string;
    leaveSuccess: string;
    controlSent: string;
    pauseDenied: string;
  };
  playlist: {
    placeholder: string;
    serverOnly: string;
    guildMismatch: string;
    ownerOnly: string;
    empty: string;
    fullQueue: string;
    notFound: string;
    playerNotReady: string;
    noSelection: string;
    addFailed: string;
    added: (count: number) => string;
    partiallyAdded: (added: number, requested: number) => string;
  };
  voice: {
    joinVoice: string;
    joinVoiceForMusic: string;
    joinBotVoiceForControl: string;
    botAlreadyConnected: string;
    joinSuccess: string;
    noActivePlayer: string;
    mustBeInBotVoiceForMusic: string;
    mustBeInBotVoiceForControl: string;
  };
  errors: {
    lavalinkNotReady: string;
    lavalinkTimeout: string;
    trackNotFound: string;
    queueLimit: string;
    genericPlay: string;
  };
};

function createAudioCommandCopy(language: BotLanguage): AudioCommandCopy {
  const messages = getMessages(language);
  const playlistMessages = messages.music;
  const permissionLanguage: PermissionLanguage = language === "fr" || language === "en" || language === "es" || language === "de"
    ? language
    : "en";
  return {
    serverOnly: messages.common.serverOnly,
    emptyQueue: playlistMessages.queueEmpty,
    noCurrentTrack: messages.common.noCurrentTrack,
    voteSkip: (votes, needed) => playlistMessages.voteRegisteredSkip.replace("{votes}", String(votes)).replace("{needed}", String(needed)),
    votePrevious: (votes, needed) => playlistMessages.voteRegisteredPrevious.replace("{votes}", String(votes)).replace("{needed}", String(needed)),
    panel: {
      queueTitle: playlistMessages.queueTitle,
      unknownAuthor: playlistMessages.unknownAuthor,
      queuedTitle: playlistMessages.adding,
      playingTitle: playlistMessages.nowPlaying,
    },
    controls: {
      guildMismatch: messages.common.controlMismatch,
      playerNotReady: playlistMessages.playerNotReady,
      noNextTrack: playlistMessages.noNextTrack,
      noPreviousTrack: playlistMessages.noPreviousTrack,
      leaveSuccess: playlistMessages.stopSuccess,
      controlSent: playlistMessages.controlSent,
      pauseDenied: playlistMessages.pauseDenied.replace("{permissionName}", permissionLabel(permissionLanguage, "ManageMessages")),
    },
    playlist: {
      placeholder: playlistMessages.playlistPlaceholder,
      serverOnly: messages.common.serverOnly,
      guildMismatch: messages.common.menuMismatch,
      ownerOnly: messages.common.ownerOnly,
      empty: playlistMessages.playlistEmpty,
      fullQueue: playlistMessages.queueLimit,
      notFound: playlistMessages.playlistNotFound,
      playerNotReady: playlistMessages.playerNotReady,
      noSelection: playlistMessages.trackNotFound,
      addFailed: playlistMessages.genericPlayError,
      added: count => tp(playlistMessages.playlistQueued, count, {
        count: String(count),
      }),
      partiallyAdded: (added, requested) => tp(playlistMessages.playlistPartiallyAdded, added, {
        added: String(added),
        requested: String(requested),
      }),
    },
    voice: {
      joinVoice: playlistMessages.joinVoice,
      joinVoiceForMusic: playlistMessages.joinVoice,
      joinBotVoiceForControl: playlistMessages.joinVoice,
      botAlreadyConnected: messages.common.botAlreadyConnected,
      joinSuccess: playlistMessages.joinSuccess,
      noActivePlayer: playlistMessages.noActivePlayer,
      mustBeInBotVoiceForMusic: playlistMessages.mustBeInSameVoice,
      mustBeInBotVoiceForControl: playlistMessages.mustBeInSameVoice,
    },
    errors: {
      lavalinkNotReady: playlistMessages.lavalinkNotReady,
      lavalinkTimeout: playlistMessages.lavalinkTimeout,
      trackNotFound: playlistMessages.trackNotFound,
      queueLimit: playlistMessages.queueLimit,
      genericPlay: playlistMessages.genericPlayError,
    },
  };
}

export const defaultAudioCommandCopy = createAudioCommandCopy("en");

export async function getAudioLanguage(guildId: string): Promise<BotLanguage> {
  return await getGuildLanguage(guildId).catch(() => "en");
}

export async function getAudioCommandCopy(guildId: string): Promise<AudioCommandCopy> {
  return createAudioCommandCopy(await getAudioLanguage(guildId));
}

export function getPlayErrorMessage(copy: AudioCommandCopy, error: unknown) {
  return getAudioUserErrorMessage(copy, error);
}

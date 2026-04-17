import { prisma } from "../config/Prisma.js";

export type DeletedGuildData = {
  currentTracksDetached: number;
  audioTracks: number;
  audioStates: number;
  privateChannels: number;
  privateConfig: number;
};

export class GuildDataRepository {
  async deleteGuildData(guildId: string): Promise<DeletedGuildData> {
    const [currentTracksDetached, audioTracks, audioStates, privateChannels, privateConfig] = await prisma.$transaction([
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
}

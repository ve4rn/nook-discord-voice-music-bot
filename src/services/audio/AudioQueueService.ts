export type VoteState = {
  trackKey: string;
  votes: Set<string>;
};

export type VoteResult = {
  vote: VoteState;
  needed: number;
  listeners: number;
  shouldPass: boolean;
};

export class AudioQueueService {
  calculateRequiredVotes(listenerCount: number) {
    return Math.max(1, Math.ceil(listenerCount / 2));
  }

  calculateRequiredSkipVotes(listenerCount: number) {
    return this.calculateRequiredVotes(listenerCount);
  }

  registerVote(
    currentVote: VoteState | undefined,
    trackKey: string,
    userId: string,
    listenerCount: number,
  ): VoteResult {
    const vote = currentVote?.trackKey === trackKey
      ? currentVote
      : { trackKey, votes: new Set<string>() };

    vote.votes.add(userId);
    const needed = this.calculateRequiredVotes(listenerCount);

    return {
      vote,
      needed,
      listeners: listenerCount,
      shouldPass: listenerCount <= 1 || vote.votes.size >= needed,
    };
  }

  registerSkipVote(
    currentVote: VoteState | undefined,
    trackKey: string,
    userId: string,
    listenerCount: number,
  ) {
    return this.registerVote(currentVote, trackKey, userId, listenerCount);
  }

  canShuffleQueue(currentTrackCount: number, queuedTrackCount: number) {
    return currentTrackCount > 0 && queuedTrackCount >= 3;
  }

  shuffleTracks<T>(tracks: T[]) {
    const copy = [...tracks];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

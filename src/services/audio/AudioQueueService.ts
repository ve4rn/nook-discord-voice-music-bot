export type SkipVoteState = {
  trackKey: string;
  votes: Set<string>;
};

export type SkipVoteResult = {
  vote: SkipVoteState;
  needed: number;
  listeners: number;
  shouldSkip: boolean;
};

export class AudioQueueService {
  calculateRequiredSkipVotes(listenerCount: number) {
    return Math.max(1, Math.floor(listenerCount / 2) + 1);
  }

  registerSkipVote(
    currentVote: SkipVoteState | undefined,
    trackKey: string,
    userId: string,
    listenerCount: number,
  ): SkipVoteResult {
    const vote = currentVote?.trackKey === trackKey
      ? currentVote
      : { trackKey, votes: new Set<string>() };

    vote.votes.add(userId);
    const needed = this.calculateRequiredSkipVotes(listenerCount);

    return {
      vote,
      needed,
      listeners: listenerCount,
      shouldSkip: listenerCount <= 1 || vote.votes.size >= needed,
    };
  }

  canShuffleQueue(currentTrackCount: number, queuedTrackCount: number) {
    return currentTrackCount > 0 && currentTrackCount + queuedTrackCount >= 5 && queuedTrackCount >= 4;
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

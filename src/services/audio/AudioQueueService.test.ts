import { describe, expect, it } from "vitest";
import { AudioQueueService } from "./AudioQueueService.js";

describe("AudioQueueService", () => {
  it("requires a majority of listeners to skip", () => {
    const service = new AudioQueueService();

    expect(service.calculateRequiredSkipVotes(1)).toBe(1);
    expect(service.calculateRequiredSkipVotes(2)).toBe(2);
    expect(service.calculateRequiredSkipVotes(5)).toBe(3);
  });

  it("resets vote state when the current track changes", () => {
    const service = new AudioQueueService();
    const first = service.registerSkipVote(undefined, "track-a", "user-1", 3);
    const second = service.registerSkipVote(first.vote, "track-b", "user-2", 3);

    expect(first.vote.votes.has("user-1")).toBe(true);
    expect(second.vote.votes.has("user-1")).toBe(false);
    expect(second.vote.votes.has("user-2")).toBe(true);
  });

  it("allows shuffle only when the displayed queue is large enough", () => {
    const service = new AudioQueueService();

    expect(service.canShuffleQueue(1, 4)).toBe(true);
    expect(service.canShuffleQueue(1, 3)).toBe(false);
    expect(service.canShuffleQueue(0, 5)).toBe(false);
  });
});

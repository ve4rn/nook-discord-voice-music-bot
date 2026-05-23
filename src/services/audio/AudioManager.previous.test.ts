import { describe, expect, it } from "vitest";
import { getJoinSessionState, prependStoredTrackOnce, shouldAppendToQueue } from "./AudioManager.js";
import type { StoredTrack } from "../../types/audio.js";

function createTrack(title: string, suffix: string): StoredTrack {
  return {
    title,
    url: `https://example.com/${suffix}`,
    duration: 180000,
    requestedBy: "user-1",
    author: "Artist",
    identifier: suffix,
  };
}

describe("prependStoredTrackOnce", () => {
  it("inserts the current track once when going back", () => {
    const current = createTrack("Current", "current");
    const queue = [createTrack("Next", "next"), createTrack("Later", "later")];

    expect(prependStoredTrackOnce(current, queue)).toEqual([
      current,
      queue[0],
      queue[1],
    ]);
  });

  it("does not duplicate the current track when it is already at the front", () => {
    const previousCurrent = createTrack("Current", "current");
    const queue = [previousCurrent, createTrack("Later", "later")];

    expect(prependStoredTrackOnce(previousCurrent, queue)).toEqual(queue);
  });
});

describe("getJoinSessionState", () => {
  it("keeps active sessions active when rejoining the voice channel", () => {
    expect(getJoinSessionState("active")).toBe("active");
  });

  it("preserves stopped sessions for explicit resume flows", () => {
    expect(getJoinSessionState("stopped")).toBe("stopped");
  });
});

describe("shouldAppendToQueue", () => {
  it("appends when a live track is already active", () => {
    expect(shouldAppendToQueue({
      sessionState: "active",
      hasPersistedCurrentTrack: true,
      isPlaying: true,
      isPaused: false,
      hasLiveCurrentTrack: true,
    })).toBe(true);
  });

  it("appends when the player briefly desyncs but the active session still has a persisted current track", () => {
    expect(shouldAppendToQueue({
      sessionState: "active",
      hasPersistedCurrentTrack: true,
      isPlaying: false,
      isPaused: false,
      hasLiveCurrentTrack: false,
    })).toBe(true);
  });

  it("does not append for a stopped session without a live current track", () => {
    expect(shouldAppendToQueue({
      sessionState: "stopped",
      hasPersistedCurrentTrack: true,
      isPlaying: false,
      isPaused: false,
      hasLiveCurrentTrack: false,
    })).toBe(false);
  });
});

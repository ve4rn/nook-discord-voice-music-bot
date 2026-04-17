import { describe, expect, it } from "vitest";
import { PrivateVoicePermissionService } from "./PrivateVoicePermissionService.js";

describe("PrivateVoicePermissionService", () => {
  it("keeps the owner in the allowed list and removes duplicates", () => {
    const service = new PrivateVoicePermissionService();

    expect(service.composeAllowedMemberIds("owner", ["a", "owner", "b"])).toEqual(["owner", "a", "b"]);
  });

  it("allows owner, admins, managers, public rooms, and explicitly allowed members", () => {
    const service = new PrivateVoicePermissionService();

    expect(service.canMemberJoinPrivateVoiceChannel({ memberId: "owner", ownerId: "owner", isPrivate: true, allowedIds: [] })).toBe(true);
    expect(service.canMemberJoinPrivateVoiceChannel({ memberId: "admin", ownerId: "owner", isPrivate: true, allowedIds: [], hasAdministratorPermission: true })).toBe(true);
    expect(service.canMemberJoinPrivateVoiceChannel({ memberId: "manager", ownerId: "owner", isPrivate: true, allowedIds: [], hasManageChannelsPermission: true })).toBe(true);
    expect(service.canMemberJoinPrivateVoiceChannel({ memberId: "guest", ownerId: "owner", isPrivate: false, allowedIds: [] })).toBe(true);
    expect(service.canMemberJoinPrivateVoiceChannel({ memberId: "friend", ownerId: "owner", isPrivate: true, allowedIds: ["friend"] })).toBe(true);
  });

  it("blocks unlisted members from private rooms", () => {
    const service = new PrivateVoicePermissionService();

    expect(service.canMemberJoinPrivateVoiceChannel({ memberId: "guest", ownerId: "owner", isPrivate: true, allowedIds: [] })).toBe(false);
  });
});

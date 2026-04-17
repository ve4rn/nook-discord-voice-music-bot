export class PrivateVoicePermissionService {
  composeAllowedMemberIds(ownerId: string, selectedUserIds: string[]) {
    return Array.from(new Set([ownerId, ...selectedUserIds])).slice(0, 25);
  }

  canMemberJoinPrivateVoiceChannel(input: {
    memberId: string;
    ownerId: string;
    isPrivate: boolean;
    allowedIds: string[];
    hasAdministratorPermission?: boolean;
    hasManageChannelsPermission?: boolean;
  }) {
    if (input.memberId === input.ownerId) return true;
    if (input.hasAdministratorPermission || input.hasManageChannelsPermission) return true;
    return !input.isPrivate || input.allowedIds.includes(input.memberId);
  }
}

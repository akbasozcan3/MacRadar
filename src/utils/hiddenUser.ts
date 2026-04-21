export const HIDDEN_USER_DISPLAY_NAME = 'MacRadar Kullanicisi';
export const HIDDEN_USER_NOT_FOUND_LABEL = 'Kullanici bulunamadi';

type ResolveUserIdentityOptions = {
  avatarUrl?: string | null;
  fullName?: string | null;
  isHidden?: boolean;
  username?: string | null;
};

export type ResolvedUserIdentity = {
  avatarUrl: string;
  displayName: string;
  handle: string;
  handleLabel: string;
  initials: string;
  isHidden: boolean;
};

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUsername(value: string | null | undefined) {
  return normalizeText(value).replace(/^@+/, '');
}

export function resolveUserIdentity({
  avatarUrl,
  fullName,
  isHidden = false,
  username,
}: ResolveUserIdentityOptions): ResolvedUserIdentity {
  const normalizedFullName = normalizeText(fullName);
  const normalizedUsername = normalizeUsername(username);
  const resolvedDisplayName = isHidden
    ? HIDDEN_USER_DISPLAY_NAME
    : normalizedFullName || normalizedUsername || HIDDEN_USER_DISPLAY_NAME;
  const resolvedHandle = isHidden ? '' : normalizedUsername;
  const source = (resolvedDisplayName || resolvedHandle || HIDDEN_USER_DISPLAY_NAME)
    .toUpperCase()
    .replace(/\s+/g, ' ');

  return {
    avatarUrl: isHidden ? '' : normalizeText(avatarUrl),
    displayName: resolvedDisplayName,
    handle: resolvedHandle,
    handleLabel: isHidden
      ? HIDDEN_USER_DISPLAY_NAME
      : resolvedHandle.length > 0
        ? `@${resolvedHandle}`
        : '',
    initials: source.slice(0, 2) || 'M',
    isHidden,
  };
}

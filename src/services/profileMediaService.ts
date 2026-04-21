import AsyncStorage from '@react-native-async-storage/async-storage';

type CollectionKind = 'liked' | 'posts' | 'saved';

export type ProfileGalleryItem = {
  authorHandle?: string;
  caption: string;
  createdAt: string;
  id: string;
  mediaUrl: string;
  source: 'camera' | 'explore';
};

export type ProfileGalleryCollections = {
  liked: ProfileGalleryItem[];
  posts: ProfileGalleryItem[];
  saved: ProfileGalleryItem[];
};

export type ExploreCollectionInput = {
  authorHandle?: string;
  caption: string;
  createdAt: string;
  mediaUrl: string;
  postId: string;
};

const STORAGE_PREFIX = 'macradar:profile-gallery:v1';
const MAX_COLLECTION_SIZE = 180;

const listenersByUser = new Map<
  string,
  Set<(collections: ProfileGalleryCollections) => void>
>();

function defaultCollections(): ProfileGalleryCollections {
  return {
    liked: [],
    posts: [],
    saved: [],
  };
}

function collectionStorageKey(userId: string, kind: CollectionKind) {
  return `${STORAGE_PREFIX}:${kind}:${userId}`;
}

function normalizeItems(raw: unknown): ProfileGalleryItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry): ProfileGalleryItem | null => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const candidate = entry as Partial<ProfileGalleryItem>;
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.mediaUrl !== 'string' ||
        typeof candidate.createdAt !== 'string' ||
        typeof candidate.caption !== 'string'
      ) {
        return null;
      }

      return {
        authorHandle:
          typeof candidate.authorHandle === 'string'
            ? candidate.authorHandle
            : undefined,
        caption: candidate.caption,
        createdAt: candidate.createdAt,
        id: candidate.id,
        mediaUrl: candidate.mediaUrl,
        source: candidate.source === 'explore' ? 'explore' : 'camera',
      };
    })
    .filter((item): item is ProfileGalleryItem => Boolean(item))
    .slice(0, MAX_COLLECTION_SIZE);
}

async function readCollection(
  userId: string,
  kind: CollectionKind,
): Promise<ProfileGalleryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(collectionStorageKey(userId, kind));
    if (!raw) {
      return [];
    }

    return normalizeItems(JSON.parse(raw));
  } catch (error) {
    console.warn('Failed to read media collection', error);
    return [];
  }
}

async function writeCollection(
  userId: string,
  kind: CollectionKind,
  items: ProfileGalleryItem[],
) {
  await AsyncStorage.setItem(
    collectionStorageKey(userId, kind),
    JSON.stringify(items.slice(0, MAX_COLLECTION_SIZE)),
  );
}

async function notifyUser(userId: string) {
  const listeners = listenersByUser.get(userId);
  if (!listeners || listeners.size === 0) {
    return;
  }

  const snapshot = await readProfileGallery(userId);
  listeners.forEach(listener => {
    listener(snapshot);
  });
}

function uniqueId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function readProfileGallery(
  userId: string,
): Promise<ProfileGalleryCollections> {
  if (userId.trim().length === 0) {
    return defaultCollections();
  }

  const [posts, liked, saved] = await Promise.all([
    readCollection(userId, 'posts'),
    readCollection(userId, 'liked'),
    readCollection(userId, 'saved'),
  ]);

  return {
    liked,
    posts,
    saved,
  };
}

export function subscribeProfileGallery(
  userId: string,
  listener: (collections: ProfileGalleryCollections) => void,
) {
  let listeners = listenersByUser.get(userId);
  if (!listeners) {
    listeners = new Set();
    listenersByUser.set(userId, listeners);
  }

  listeners.add(listener);
  readProfileGallery(userId)
    .then(snapshot => {
      listener(snapshot);
    })
    .catch(() => {
      listener(defaultCollections());
    });

  return () => {
    const bucket = listenersByUser.get(userId);
    if (!bucket) {
      return;
    }
    bucket.delete(listener);
    if (bucket.size === 0) {
      listenersByUser.delete(userId);
    }
  };
}

export async function addCapturedPost(
  userId: string,
  payload: { caption?: string; mediaUrl: string },
) {
  if (userId.trim().length === 0 || payload.mediaUrl.trim().length === 0) {
    return null;
  }

  const nextItem: ProfileGalleryItem = {
    caption: payload.caption?.trim() ?? '',
    createdAt: new Date().toISOString(),
    id: uniqueId('camera'),
    mediaUrl: payload.mediaUrl.trim(),
    source: 'camera',
  };

  const current = await readCollection(userId, 'posts');
  await writeCollection(userId, 'posts', [nextItem, ...current]);
  await notifyUser(userId);
  return nextItem;
}

export async function syncExploreReactionCollection(
  userId: string,
  kind: Exclude<CollectionKind, 'posts'>,
  payload: ExploreCollectionInput,
  active: boolean,
) {
  if (
    userId.trim().length === 0 ||
    payload.mediaUrl.trim().length === 0 ||
    payload.postId.trim().length === 0
  ) {
    return;
  }

  const collectionId = `explore_${payload.postId.trim()}`;
  const current = await readCollection(userId, kind);
  const existingIndex = current.findIndex(item => item.id === collectionId);

  if (!active && existingIndex < 0) {
    return;
  }

  if (active) {
    const nextItem: ProfileGalleryItem = {
      authorHandle: payload.authorHandle?.trim() || undefined,
      caption: payload.caption.trim(),
      createdAt: payload.createdAt,
      id: collectionId,
      mediaUrl: payload.mediaUrl.trim(),
      source: 'explore',
    };

    const filtered = current.filter(item => item.id !== collectionId);
    await writeCollection(userId, kind, [nextItem, ...filtered]);
    await notifyUser(userId);
    return;
  }

  const next = [...current];
  next.splice(existingIndex, 1);
  await writeCollection(userId, kind, next);
  await notifyUser(userId);
}

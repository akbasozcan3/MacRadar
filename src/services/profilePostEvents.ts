import type { PublicProfilePostItem } from '../types/AuthTypes/AuthTypes';

type ProfilePostCreatedListener = (post: PublicProfilePostItem) => void;

const createdListeners = new Set<ProfilePostCreatedListener>();

export function emitProfilePostCreated(post: PublicProfilePostItem) {
  createdListeners.forEach(listener => {
    listener(post);
  });
}

export function subscribeProfilePostCreated(
  listener: ProfilePostCreatedListener,
) {
  createdListeners.add(listener);
  return () => {
    createdListeners.delete(listener);
  };
}

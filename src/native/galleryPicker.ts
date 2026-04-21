import { NativeModules } from 'react-native';

export type GalleryPickerMediaType = 'mixed' | 'photo' | 'video';

export type GalleryMediaSelection = {
  fileName?: string;
  mediaType: 'photo' | 'video';
  mediaUrl: string;
  mimeType?: string;
  sizeBytes?: number;
  thumbnailUrl?: string;
};

type NativeGalleryPickerModule = {
  createVideoThumbnail: (uri: string) => Promise<string | null>;
  pickMedia: (
    mediaType?: GalleryPickerMediaType,
  ) => Promise<GalleryMediaSelection | null>;
};

const nativeGalleryPicker = NativeModules.GalleryPickerModule as
  | NativeGalleryPickerModule
  | undefined;

function requireGalleryPicker() {
  if (!nativeGalleryPicker) {
    throw new Error('Galeri secimi bu derlemede hazir degil.');
  }
  return nativeGalleryPicker;
}

export async function pickGalleryMedia(
  mediaType: GalleryPickerMediaType = 'mixed',
) {
  const selection = await requireGalleryPicker().pickMedia(mediaType);
  if (!selection || !selection.mediaUrl) {
    return null;
  }

  return {
    ...selection,
    mediaType: selection.mediaType === 'video' ? 'video' : 'photo',
  } satisfies GalleryMediaSelection;
}

export async function createVideoThumbnail(uri: string) {
  const resolved = await requireGalleryPicker().createVideoThumbnail(uri);
  return typeof resolved === 'string' && resolved.trim().length > 0
    ? resolved.trim()
    : null;
}

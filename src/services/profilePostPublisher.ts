import { API_BASE_URL } from '../config/exploreApi';
import {
  normalizeProfilePostCaption,
  normalizeProfilePostLocation,
  validateProfilePostInput,
} from '../features/profilePosts/postComposerValidation';
import { getAppLanguage } from '../i18n/runtime';
import {
  createMyProfilePost,
  uploadProfilePostMedia as uploadProfilePostMediaViaApiRequest,
} from './authService';
import { ApiRequestError, getApiSessionToken } from './apiClient';
import { isLocalMediaUri } from './protectedMedia';
import type {
  CreateProfilePostPayload,
  ProfilePostMediaUploadResponse,
  PublicProfilePostItem,
} from '../types/AuthTypes/AuthTypes';

export type PublishProfilePostProgressPhase =
  | 'preparing'
  | 'uploading'
  | 'creating'
  | 'retrying'
  | 'completed';

export type PublishProfilePostProgress = {
  message: string;
  phase: PublishProfilePostProgressPhase;
  progress: number;
};

export type PublishProfilePostPayload = CreateProfilePostPayload & {
  thumbnailUrl?: string;
};

type PublishProfilePostOptions = {
  maxAttempts?: number;
  onProgress?: (progress: PublishProfilePostProgress) => void;
};

const DEFAULT_MAX_ATTEMPTS = 3;

function clampProgress(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function reportProgress(
  onProgress: PublishProfilePostOptions['onProgress'],
  progress: PublishProfilePostProgress,
) {
  onProgress?.({
    ...progress,
    progress: clampProgress(progress.progress),
  });
}

function inferProfilePostUploadMimeType(
  mediaType: 'photo' | 'video',
  mediaUrl: string,
) {
  const normalizedUrl = mediaUrl.trim().toLowerCase();
  if (mediaType === 'video') {
    if (normalizedUrl.endsWith('.mov')) {
      return 'video/quicktime';
    }
    return 'video/mp4';
  }

  if (normalizedUrl.endsWith('.png')) {
    return 'image/png';
  }
  if (normalizedUrl.endsWith('.heic') || normalizedUrl.endsWith('.heif')) {
    return 'image/heic';
  }
  return 'image/jpeg';
}

function inferProfilePostUploadFileName(
  mediaType: 'photo' | 'video',
  mediaUrl: string,
) {
  const sanitizedSegment =
    mediaUrl.split('?')[0]?.split('/').pop()?.trim() ?? '';
  if (sanitizedSegment.length > 0 && sanitizedSegment.includes('.')) {
    return sanitizedSegment;
  }

  if (mediaType === 'video') {
    return 'captured-post.mp4';
  }
  return 'captured-post.jpg';
}

function extractEnvelope<T>(value: unknown): T {
  if (value && typeof value === 'object' && 'data' in value) {
    return (value as { data: T }).data;
  }
  return value as T;
}

function rejectFromPayload(
  xhr: XMLHttpRequest,
  reject: (error: ApiRequestError) => void,
) {
  let payload: any = null;
  try {
    payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
  } catch {
    payload = null;
  }

  const envelopeError =
    payload && typeof payload === 'object' && 'error' in payload
      ? payload.error
      : null;
  const nestedError =
    payload &&
    typeof payload === 'object' &&
    'data' in payload &&
    payload.data &&
    typeof payload.data === 'object' &&
    'error' in payload.data
      ? payload.data.error
      : null;
  const flatMessage =
    payload && typeof payload?.message === 'string' ? payload.message : '';
  const message =
    envelopeError?.message ||
    nestedError?.message ||
    flatMessage ||
    xhr.responseText ||
    'Yukleme tamamlanamadi.';
  reject(
    new ApiRequestError(message, {
      code: envelopeError?.code || nestedError?.code || payload?.code,
      details:
        envelopeError?.details || nestedError?.details || payload?.details,
      status: xhr.status || 500,
    }),
  );
}

function wait(delayMs: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, delayMs);
  });
}

function shouldRetryPublish(error: unknown) {
  if (!(error instanceof ApiRequestError)) {
    return true;
  }

  if (error.status === 408 || error.status === 429) {
    return true;
  }

  if (error.status >= 500) {
    return true;
  }

  return error.code === 'profile_post_media_upload_network_error';
}

function isMultipartFormParseError(error: unknown) {
  if (!(error instanceof ApiRequestError)) {
    return false;
  }

  const normalizedCode = String(error.code || '')
    .trim()
    .toLowerCase();
  if (normalizedCode === 'invalid_profile_post_media') {
    return true;
  }

  const normalizedMessage = String(error.message || '')
    .trim()
    .toLowerCase();
  return normalizedMessage.includes('medya formu cozumlenemedi');
}

async function uploadProfilePostMediaWithProgress(
  payload: {
    mediaType: 'photo' | 'video';
    mediaUrl: string;
    thumbnailUrl?: string;
  },
  onProgress?: (progress: PublishProfilePostProgress) => void,
) {
  const normalizedMediaUrl = payload.mediaUrl.trim();
  if (!isLocalMediaUri(normalizedMediaUrl)) {
    return {
      asset: {
        id: normalizedMediaUrl,
        mediaType: payload.mediaType,
        mediaUrl: normalizedMediaUrl,
        mimeType: inferProfilePostUploadMimeType(
          payload.mediaType,
          normalizedMediaUrl,
        ),
        sizeBytes: 0,
        thumbnailUrl: payload.thumbnailUrl?.trim() || undefined,
        uploadedAt: new Date().toISOString(),
      },
    } satisfies ProfilePostMediaUploadResponse;
  }

  reportProgress(onProgress, {
    message: 'Medya backend storage alanina yukleniyor...',
    phase: 'uploading',
    progress: 0.08,
  });

  const form = new FormData();
  form.append('mediaType', payload.mediaType);
  form.append('file', {
    name: inferProfilePostUploadFileName(payload.mediaType, normalizedMediaUrl),
    type: inferProfilePostUploadMimeType(payload.mediaType, normalizedMediaUrl),
    uri: normalizedMediaUrl,
  } as any);

  const token = getApiSessionToken();
  const appLanguage = getAppLanguage();

  return new Promise<ProfilePostMediaUploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/api/v1/profile/me/post-media`);
    xhr.timeout = payload.mediaType === 'video' ? 120000 : 45000;
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Accept-Language', appLanguage);
    xhr.setRequestHeader('X-App-Language', appLanguage);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || event.total <= 0) {
        return;
      }
      const uploadRatio = event.loaded / event.total;
      reportProgress(onProgress, {
        message: 'Medya backend storage alanina yukleniyor...',
        phase: 'uploading',
        progress: 0.08 + uploadRatio * 0.72,
      });
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        rejectFromPayload(xhr, reject);
        return;
      }

      try {
        const parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        resolve(extractEnvelope<ProfilePostMediaUploadResponse>(parsed));
      } catch (error) {
        reject(
          new ApiRequestError(
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : 'Yukleme cevabi islenemedi.',
            {
              code: 'profile_post_media_upload_parse_failed',
              status: xhr.status || 500,
            },
          ),
        );
      }
    };

    xhr.onerror = () => {
      reject(
        new ApiRequestError('Yukleme sirasinda ag hatasi olustu.', {
          code: 'profile_post_media_upload_network_error',
          status: xhr.status || 0,
        }),
      );
    };

    xhr.ontimeout = () => {
      reject(
        new ApiRequestError('Yukleme zaman asimina ugradi.', {
          code: 'profile_post_media_upload_timeout',
          status: 408,
        }),
      );
    };

    xhr.send(form);
  });
}

export async function publishProfilePost(
  payload: PublishProfilePostPayload,
  options?: PublishProfilePostOptions,
) {
  const normalizedCaption = normalizeProfilePostCaption(payload.caption);
  const normalizedLocation = normalizeProfilePostLocation(payload.location);
  const validationMessage = validateProfilePostInput({
    caption: normalizedCaption,
    location: normalizedLocation,
    mediaType: payload.mediaType,
    mediaUrl: payload.mediaUrl,
  });
  if (validationMessage) {
    throw new ApiRequestError(validationMessage, {
      code: 'invalid_profile_post_payload',
      status: 400,
    });
  }

  const maxAttempts = Math.max(
    1,
    Math.min(5, Math.floor(options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
  );

  let attempt = 0;
  let lastError: unknown = null;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      reportProgress(options?.onProgress, {
        message:
          payload.mediaType === 'video'
            ? 'Video paylasimi hazirlaniyor...'
            : 'Gonderi hazirlaniyor...',
        phase: 'preparing',
        progress: 0.03,
      });

      let uploadedMedia: ProfilePostMediaUploadResponse;
      try {
        uploadedMedia = await uploadProfilePostMediaWithProgress(
          {
            mediaType: payload.mediaType,
            mediaUrl: payload.mediaUrl,
            thumbnailUrl: payload.thumbnailUrl,
          },
          options?.onProgress,
        );
      } catch (uploadError) {
        if (!isMultipartFormParseError(uploadError)) {
          throw uploadError;
        }

        reportProgress(options?.onProgress, {
          message: 'Alternatif medya yukleme deneniyor...',
          phase: 'retrying',
          progress: 0.22,
        });
        uploadedMedia = await uploadProfilePostMediaViaApiRequest({
          mediaType: payload.mediaType,
          mediaUrl: payload.mediaUrl,
        });
      }

      reportProgress(options?.onProgress, {
        message: 'Gonderi backend kaydina yaziliyor...',
        phase: 'creating',
        progress: 0.9,
      });

      const createdPost = await createMyProfilePost({
        caption: normalizedCaption,
        location: normalizedLocation || undefined,
        locationPayload: payload.locationPayload,
        mediaType: uploadedMedia.asset.mediaType,
        mediaUrl: uploadedMedia.asset.mediaUrl,
        thumbnailUrl: uploadedMedia.asset.thumbnailUrl ?? payload.thumbnailUrl,
        visibility: payload.visibility,
      });

      reportProgress(options?.onProgress, {
        message: 'Paylasim tamamlandi.',
        phase: 'completed',
        progress: 1,
      });

      return createdPost satisfies PublicProfilePostItem;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetryPublish(error)) {
        break;
      }

      reportProgress(options?.onProgress, {
        message: `Baglanti tekrar deneniyor (${attempt + 1}/${maxAttempts})...`,
        phase: 'retrying',
        progress: 0.18,
      });
      await wait(600 * attempt);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Paylasim tamamlanamadi.');
}

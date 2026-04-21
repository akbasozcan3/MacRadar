export const PROFILE_POST_CAPTION_MAX_LENGTH = 280;
export const PROFILE_POST_HASHTAG_MAX_COUNT = 8;
export const PROFILE_POST_HASHTAG_MAX_LENGTH = 32;
export const PROFILE_POST_LOCATION_MAX_LENGTH = 120;

type ProfilePostValidationInput = {
  caption?: string | null;
  location?: string | null;
  mediaType?: string | null;
  mediaUrl?: string | null;
};

function coerceString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

export function sanitizeProfilePostCaptionInput(value: unknown) {
  return coerceString(value)
    .split('\0')
    .join('')
    .slice(0, PROFILE_POST_CAPTION_MAX_LENGTH);
}

export function sanitizeProfilePostLocationInput(value: unknown) {
  return coerceString(value)
    .split('\0')
    .join('')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, PROFILE_POST_LOCATION_MAX_LENGTH);
}

export function normalizeProfilePostCaption(value: unknown) {
  return sanitizeProfilePostCaptionInput(value).trim();
}

export function normalizeProfilePostLocation(value: unknown) {
  return sanitizeProfilePostLocationInput(value).trim();
}

export function extractProfilePostHashtags(value: unknown) {
  const caption = sanitizeProfilePostCaptionInput(value);
  const pattern =
    /#([\p{L}\p{N}_]{2,32})/gu;
  const seen = new Set<string>();
  const tags: string[] = [];

  let match = pattern.exec(caption);
  while (match) {
    const tag = match[1]?.trim().toLocaleLowerCase('tr-TR');
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
    match = pattern.exec(caption);
  }

  return tags;
}

export function validateProfilePostInput(input: ProfilePostValidationInput) {
  const normalizedCaption = normalizeProfilePostCaption(input.caption);
  const normalizedLocation = normalizeProfilePostLocation(input.location);
  const normalizedMediaType = coerceString(input.mediaType).trim().toLowerCase();
  const normalizedMediaUrl = coerceString(input.mediaUrl).trim();
  const hashtags = extractProfilePostHashtags(normalizedCaption);

  if (!normalizedMediaUrl) {
    return 'Paylasim icin medya secilmesi gerekiyor.';
  }

  if (normalizedMediaType !== 'photo' && normalizedMediaType !== 'video') {
    return 'Medya tipi desteklenmiyor.';
  }

  if (normalizedCaption.length > PROFILE_POST_CAPTION_MAX_LENGTH) {
    return `Aciklama en fazla ${PROFILE_POST_CAPTION_MAX_LENGTH} karakter olabilir.`;
  }

  if (normalizedLocation.length > PROFILE_POST_LOCATION_MAX_LENGTH) {
    return `Konum en fazla ${PROFILE_POST_LOCATION_MAX_LENGTH} karakter olabilir.`;
  }

  if (hashtags.length > PROFILE_POST_HASHTAG_MAX_COUNT) {
    return `Bir gonderide en fazla ${PROFILE_POST_HASHTAG_MAX_COUNT} etiket kullanabilirsin.`;
  }

  return null;
}

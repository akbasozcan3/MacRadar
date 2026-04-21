import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';

import { useAlert } from '../../alerts/AlertProvider';
import AppMedia from '../Media/AppMedia';
import FeatherIcon from '../FeatherIcon/FeatherIcon';
import IosSpinner from '../IosSpinner/IosSpinner';
import LocationAutocomplete from '../LocationAutocomplete/LocationAutocomplete';
import { buildPostLocationPayload } from '../../features/profilePosts/locationPayload';
import {
  PROFILE_POST_CAPTION_MAX_LENGTH,
  PROFILE_POST_HASHTAG_MAX_COUNT,
  PROFILE_POST_LOCATION_MAX_LENGTH,
  extractProfilePostHashtags,
  normalizeProfilePostCaption,
  normalizeProfilePostLocation,
  sanitizeProfilePostCaptionInput,
  sanitizeProfilePostLocationInput,
  validateProfilePostInput,
} from '../../features/profilePosts/postComposerValidation';
import {
  mapLocationAutocompleteResultToSelectedLocation,
  searchMapboxLocations,
} from '../../services/locationAutocompleteService';
import {
  fetchExploreTagDetail,
  fetchExploreTrendingTags,
  updateProfilePost,
} from '../../services/exploreService';
import { Text, TextInput } from '../../theme/typography';
import type { ProfilePostVisibility } from '../../types/AuthTypes/AuthTypes';
import type {
  ExploreTagDetailResponse,
  ExploreTrendingTag,
} from '../../types/ExploreTypes/ExploreTypes';
import type {
  LocationAutocompleteResult,
  PostLocationPayload,
  SelectedLocation,
} from '../../types/LocationTypes/LocationTypes';

export type PostComposerVisibility = ProfilePostVisibility;

export type PostComposerDraft = {
  capturedAt: string;
  mediaType: 'photo' | 'video';
  mediaUrl: string;
  source?: 'camera' | 'gallery';
  thumbnailUrl?: string;
};

type PostComposerModalProps = {
  draft: PostComposerDraft | null;
  initialValues?: {
    caption?: string;
    location?: string;
    visibility?: PostComposerVisibility;
  };
  mode?: 'create' | 'edit';
  onBackToCamera?: (() => void) | null;
  onClose: () => void;
  onSubmit: (
    payload: {
      caption: string;
      location?: string;
      locationPayload?: PostLocationPayload;
      mediaType: 'photo' | 'video';
      mediaUrl: string;
      thumbnailUrl?: string;
      visibility: PostComposerVisibility;
    },
    options?: {
      onProgress?: (progress: {
        message: string;
        phase:
          | 'completed'
          | 'creating'
          | 'preparing'
          | 'retrying'
          | 'uploading';
        progress: number;
      }) => void;
    },
  ) => Promise<void>;
  safeBottom: number;
  safeTop: number;
  postId?: string;
  presentation?: 'modal' | 'screen';
  viewerAvatarUrl?: string;
  viewerDisplayName?: string;
  viewerIsPrivateAccount?: boolean;
  visible: boolean;
};

type HashtagSuggestionContext = {
  end: number;
  hashStart: number;
  normalizedQuery: string;
  rawQuery: string;
};

type TrendingTagDetailTab = 'recent' | 'top';

const PRIVACY_OPTIONS: Array<{
  description: string;
  icon: 'globe' | 'lock' | 'users';
  key: PostComposerVisibility;
  title: string;
}> = [
  {
    description: 'Uygulamadaki herkes gorebilir',
    icon: 'globe',
    key: 'public',
    title: 'Herkese Açık',
  },
  {
    description: 'Sadece onayladigin arkadaslarin gorebilir',
    icon: 'users',
    key: 'friends',
    title: 'Sadece Arkadaslar',
  },
  {
    description: 'Sadece sen gorursun',
    icon: 'lock',
    key: 'private',
    title: 'Sadece Ben',
  },
];

const TRENDING_TAG_SUGGESTION_LIMIT = 8;
const TRENDING_TAG_BROWSER_DEBOUNCE_MS = 220;
const TRENDING_TAG_CACHE_TTL_MS = 60_000;
const LOCATION_AUTOCOMPLETE_BLUR_CLOSE_DELAY_MS = 120;
const LOCATION_AUTOCOMPLETE_DEBOUNCE_MS = 260;
const LOCATION_AUTOCOMPLETE_LIMIT = 6;
const LOCATION_AUTOCOMPLETE_MIN_QUERY_LENGTH = 2;
const LOCATION_AUTOCOMPLETE_TIMEOUT_MS = 7_000;
const TRENDING_TAG_BROWSER_LIMIT = 24;
const TRENDING_TAG_DETAIL_POST_LIMIT = 14;

let cachedTrendingTagSuggestions:
  | { expiresAt: number; tags: ExploreTrendingTag[] }
  | null = null;

function resolveErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

function resolveSourceLabel(source?: PostComposerDraft['source']) {
  if (source === 'gallery') {
    return 'Galeri';
  }
  if (source === 'camera') {
    return 'Kamera';
  }
  return 'Medya';
}

function formatTrendingTagMeta(tag: ExploreTrendingTag) {
  const recentCount =
    typeof tag.recentCount === 'number' && Number.isFinite(tag.recentCount)
      ? Math.max(0, Math.round(tag.recentCount))
      : 0;
  const totalCount = Math.max(0, Math.round(tag.count || 0));

  if (recentCount > 0 && totalCount > recentCount) {
    return `Son 48s ${recentCount} / Toplam ${totalCount}`;
  }
  if (recentCount > 0) {
    return `Son 48s ${recentCount}`;
  }
  if (totalCount === 1) {
    return '1 gonderi';
  }
  return `${totalCount} gonderi`;
}

function appendHashtagToCaption(currentValue: string, rawTag: string) {
  const normalizedTag = rawTag.trim().replace(/^#+/, '').toLocaleLowerCase('tr-TR');
  if (!normalizedTag) {
    return sanitizeProfilePostCaptionInput(currentValue);
  }

  const existingTags = extractProfilePostHashtags(currentValue);
  if (existingTags.includes(normalizedTag)) {
    return sanitizeProfilePostCaptionInput(currentValue);
  }

  const base = sanitizeProfilePostCaptionInput(currentValue).trimEnd();
  const separator = base.length === 0 ? '' : ' ';
  return sanitizeProfilePostCaptionInput(`${base}${separator}#${normalizedTag}`);
}

function normalizeHashtagQueryValue(value: string) {
  return value.trim().replace(/^#+/, '').toLocaleLowerCase('tr-TR');
}

function normalizeTrendingTagKey(rawTag: string) {
  return rawTag.trim().replace(/^#+/, '').toLocaleLowerCase('tr-TR');
}

function formatCompactCount(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return safeValue.toLocaleString('tr-TR');
}

function formatTrendingTagActivity(lastUsedAt?: string) {
  if (!lastUsedAt) {
    return 'Bilinmiyor';
  }

  const timestamp = Date.parse(lastUsedAt);
  if (!Number.isFinite(timestamp)) {
    return 'Bilinmiyor';
  }

  const deltaMs = Date.now() - timestamp;
  if (deltaMs <= 0) {
    return 'Simdi';
  }

  const minuteMs = 60_000;
  const hourMs = 3_600_000;
  const dayMs = 86_400_000;
  if (deltaMs < hourMs) {
    return `${Math.max(1, Math.floor(deltaMs / minuteMs))} dk once`;
  }
  if (deltaMs < dayMs) {
    return `${Math.max(1, Math.floor(deltaMs / hourMs))} sa once`;
  }
  return `${Math.max(1, Math.floor(deltaMs / dayMs))} gun once`;
}

function resolveHashtagSuggestionContext(
  value: string,
  cursor: number,
): HashtagSuggestionContext | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const beforeCursor = value.slice(0, safeCursor);
  const matched = /(^|\s)#([\p{L}\p{N}_]{0,32})$/u.exec(beforeCursor);
  if (!matched) {
    return null;
  }

  const rawQuery = matched[2] ?? '';
  const hashStart = safeCursor - rawQuery.length - 1;
  if (hashStart < 0) {
    return null;
  }

  return {
    end: safeCursor,
    hashStart,
    normalizedQuery: normalizeHashtagQueryValue(rawQuery),
    rawQuery,
  };
}

function applyHashtagSuggestion(
  currentValue: string,
  context: HashtagSuggestionContext,
  tag: string,
) {
  const normalizedTag = normalizeHashtagQueryValue(tag);
  if (!normalizedTag) {
    return {
      nextCursor: context.end,
      nextValue: sanitizeProfilePostCaptionInput(currentValue),
    };
  }

  const prefix = currentValue.slice(0, context.hashStart);
  const suffix = currentValue.slice(context.end).replace(/^\s+/, '');
  const replacement = `#${normalizedTag} `;
  const nextValue = sanitizeProfilePostCaptionInput(
    `${prefix}${replacement}${suffix}`,
  );
  const nextCursor = Math.min(nextValue.length, prefix.length + replacement.length);

  return {
    nextCursor,
    nextValue,
  };
}

export default function PostComposerModal({
  draft,
  initialValues,
  mode = 'create',
  onBackToCamera,
  onClose,
  onSubmit,
  postId,
  presentation = 'modal',
  safeBottom,
  safeTop,
  viewerAvatarUrl,
  viewerDisplayName,
  viewerIsPrivateAccount = false,
  visible,
}: PostComposerModalProps) {
  const { showToast } = useAlert();
  const [caption, setCaption] = useState('');
  const [captionSelection, setCaptionSelection] = useState({ end: 0, start: 0 });
  const [isCaptionFocused, setIsCaptionFocused] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationResults, setLocationResults] = useState<
    LocationAutocompleteResult[]
  >([]);
  const [selectedLocation, setSelectedLocation] =
    useState<SelectedLocation | null>(null);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [locationSearchError, setLocationSearchError] = useState<string | null>(
    null,
  );
  const [visibility, setVisibility] =
    useState<PostComposerVisibility>('public');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSuggestedTags, setIsLoadingSuggestedTags] = useState(false);
  const [submitMessage, setSubmitMessage] = useState('');
  const [submitProgress, setSubmitProgress] = useState(0);
  const [suggestedTags, setSuggestedTags] = useState<ExploreTrendingTag[]>([]);
  const [suggestedTagsError, setSuggestedTagsError] = useState<string | null>(
    null,
  );
  const [isTrendingTagBrowserVisible, setIsTrendingTagBrowserVisible] =
    useState(false);
  const [trendingTagBrowserQuery, setTrendingTagBrowserQuery] = useState('');
  const [trendingTagBrowserResults, setTrendingTagBrowserResults] = useState<
    ExploreTrendingTag[]
  >([]);
  const [isLoadingTrendingTagBrowser, setIsLoadingTrendingTagBrowser] =
    useState(false);
  const [trendingTagBrowserError, setTrendingTagBrowserError] = useState<
    string | null
  >(null);
  const [activeTrendingTagKey, setActiveTrendingTagKey] = useState<string | null>(
    null,
  );
  const [activeTrendingTagDetail, setActiveTrendingTagDetail] =
    useState<ExploreTagDetailResponse | null>(null);
  const [isLoadingTrendingTagDetail, setIsLoadingTrendingTagDetail] =
    useState(false);
  const [trendingTagDetailError, setTrendingTagDetailError] = useState<
    string | null
  >(null);
  const [trendingTagDetailTab, setTrendingTagDetailTab] =
    useState<TrendingTagDetailTab>('top');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingDiscardAction, setPendingDiscardAction] = useState<
    'back' | 'close' | null
  >(null);
  const hashtagSuggestionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const trendingTagBrowserDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hashtagSuggestionRequestIdRef = useRef(0);
  const trendingTagBrowserRequestIdRef = useRef(0);
  const trendingTagDetailRequestIdRef = useRef(0);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationRequestAbortRef = useRef<AbortController | null>(null);
  const locationRequestIdRef = useRef(0);
  const locationInputFocusedRef = useRef(false);
  const locationSuggestionPressRef = useRef(false);
  const suppressNextAutocompleteFetchRef = useRef(false);
  const isCreateMode = mode === 'create';
  const discardOverlayOpacity = useRef(new Animated.Value(0)).current;
  const discardCardScale = useRef(new Animated.Value(0.94)).current;

  const initialSnapshot = useMemo(
    () => ({
      caption: normalizeProfilePostCaption(initialValues?.caption),
      location: normalizeProfilePostLocation(initialValues?.location),
      visibility:
        viewerIsPrivateAccount
          ? ('friends' as PostComposerVisibility)
          : initialValues?.visibility === 'friends' ||
              initialValues?.visibility === 'private' ||
              initialValues?.visibility === 'public'
            ? initialValues.visibility
            : 'public',
    }),
    [
      initialValues?.caption,
      initialValues?.location,
      initialValues?.visibility,
      viewerIsPrivateAccount,
    ],
  );
  const visibilityOptions = useMemo(
    () =>
      viewerIsPrivateAccount
        ? PRIVACY_OPTIONS.filter(option => option.key === 'friends')
        : PRIVACY_OPTIONS,
    [viewerIsPrivateAccount],
  );

  useEffect(() => {
    if (!visible) {
      locationInputFocusedRef.current = false;
      locationSuggestionPressRef.current = false;
      suppressNextAutocompleteFetchRef.current = false;
      setCaption('');
      setCaptionSelection({ end: 0, start: 0 });
      setIsCaptionFocused(false);
      setLocationQuery('');
      setLocationResults([]);
      setSelectedLocation(null);
      setLoadingLocations(false);
      setShowSuggestions(false);
      setLocationSearchError(null);
      setVisibility(viewerIsPrivateAccount ? 'friends' : 'public');
      setIsSubmitting(false);
      setSubmitMessage('');
      setSubmitProgress(0);
      setSubmitError(null);
      setPendingDiscardAction(null);
      setIsTrendingTagBrowserVisible(false);
      setTrendingTagBrowserQuery('');
      setTrendingTagBrowserResults([]);
      setIsLoadingTrendingTagBrowser(false);
      setTrendingTagBrowserError(null);
      setActiveTrendingTagKey(null);
      setActiveTrendingTagDetail(null);
      setIsLoadingTrendingTagDetail(false);
      setTrendingTagDetailError(null);
      setTrendingTagDetailTab('top');
      return;
    }

    setCaption(initialSnapshot.caption);
    setCaptionSelection({
      end: initialSnapshot.caption.length,
      start: initialSnapshot.caption.length,
    });
    setIsCaptionFocused(false);
    locationInputFocusedRef.current = false;
    locationSuggestionPressRef.current = false;
    suppressNextAutocompleteFetchRef.current = false;
    setLocationQuery(initialSnapshot.location);
    setLocationResults([]);
    setSelectedLocation(null);
    setLoadingLocations(false);
    setShowSuggestions(false);
    setLocationSearchError(null);
    setVisibility(initialSnapshot.visibility);
    setIsSubmitting(false);
    setSubmitMessage('');
    setSubmitProgress(0);
    setSubmitError(null);
    setPendingDiscardAction(null);
    setIsTrendingTagBrowserVisible(false);
    setTrendingTagBrowserQuery('');
    setTrendingTagBrowserResults([]);
    setIsLoadingTrendingTagBrowser(false);
    setTrendingTagBrowserError(null);
    setActiveTrendingTagKey(null);
    setActiveTrendingTagDetail(null);
    setIsLoadingTrendingTagDetail(false);
    setTrendingTagDetailError(null);
    setTrendingTagDetailTab('top');
  }, [
    initialSnapshot.caption,
    initialSnapshot.location,
    initialSnapshot.visibility,
    visible,
    draft?.mediaType,
    draft?.mediaUrl,
    viewerIsPrivateAccount,
  ]);

  useEffect(() => {
    if (viewerIsPrivateAccount && visibility !== 'friends') {
      setVisibility('friends');
    }
  }, [viewerIsPrivateAccount, visibility]);

  const activeHashtagContext = useMemo(
    () => resolveHashtagSuggestionContext(caption, captionSelection.start),
    [caption, captionSelection.start],
  );

  useEffect(() => {
    if (!visible) {
      if (hashtagSuggestionDebounceRef.current) {
        clearTimeout(hashtagSuggestionDebounceRef.current);
        hashtagSuggestionDebounceRef.current = null;
      }
      setIsLoadingSuggestedTags(false);
      setSuggestedTagsError(null);
      return;
    }

    if (isCreateMode && !activeHashtagContext) {
      if (hashtagSuggestionDebounceRef.current) {
        clearTimeout(hashtagSuggestionDebounceRef.current);
        hashtagSuggestionDebounceRef.current = null;
      }
      setIsLoadingSuggestedTags(false);
      setSuggestedTagsError(null);
      return;
    }

    const query =
      isCreateMode && activeHashtagContext
        ? activeHashtagContext.rawQuery
        : '';
    const normalizedQuery = query.trim();

    if (
      normalizedQuery.length === 0 &&
      cachedTrendingTagSuggestions &&
      cachedTrendingTagSuggestions.expiresAt > Date.now()
    ) {
      setSuggestedTags(cachedTrendingTagSuggestions.tags);
      setSuggestedTagsError(null);
      setIsLoadingSuggestedTags(false);
      return;
    }

    if (hashtagSuggestionDebounceRef.current) {
      clearTimeout(hashtagSuggestionDebounceRef.current);
      hashtagSuggestionDebounceRef.current = null;
    }

    const requestId = hashtagSuggestionRequestIdRef.current + 1;
    hashtagSuggestionRequestIdRef.current = requestId;
    hashtagSuggestionDebounceRef.current = setTimeout(() => {
      setIsLoadingSuggestedTags(true);
      setSuggestedTagsError(null);
      fetchExploreTrendingTags({
        limit: TRENDING_TAG_SUGGESTION_LIMIT,
        query: normalizedQuery.length > 0 ? normalizedQuery : undefined,
      })
        .then(response => {
          if (requestId !== hashtagSuggestionRequestIdRef.current) {
            return;
          }
          setSuggestedTags(response.tags);
          if (normalizedQuery.length === 0) {
            cachedTrendingTagSuggestions = {
              expiresAt: Date.now() + TRENDING_TAG_CACHE_TTL_MS,
              tags: response.tags,
            };
          }
        })
        .catch(error => {
          if (requestId !== hashtagSuggestionRequestIdRef.current) {
            return;
          }
          setSuggestedTags([]);
          setSuggestedTagsError(
            resolveErrorMessage(error, 'Trend etiketler su an yuklenemedi.'),
          );
        })
        .finally(() => {
          if (requestId === hashtagSuggestionRequestIdRef.current) {
            setIsLoadingSuggestedTags(false);
          }
        });
    }, 170);

    return () => {
      if (hashtagSuggestionDebounceRef.current) {
        clearTimeout(hashtagSuggestionDebounceRef.current);
        hashtagSuggestionDebounceRef.current = null;
      }
    };
  }, [activeHashtagContext, isCreateMode, visible]);

  useEffect(() => {
    return () => {
      if (hashtagSuggestionDebounceRef.current) {
        clearTimeout(hashtagSuggestionDebounceRef.current);
        hashtagSuggestionDebounceRef.current = null;
      }
      if (trendingTagBrowserDebounceRef.current) {
        clearTimeout(trendingTagBrowserDebounceRef.current);
        trendingTagBrowserDebounceRef.current = null;
      }
      if (locationDebounceRef.current) {
        clearTimeout(locationDebounceRef.current);
        locationDebounceRef.current = null;
      }
      if (locationHideRef.current) {
        clearTimeout(locationHideRef.current);
        locationHideRef.current = null;
      }
      if (locationRequestAbortRef.current) {
        locationRequestAbortRef.current.abort();
        locationRequestAbortRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingDiscardAction) {
      return;
    }

    discardOverlayOpacity.setValue(0);
    discardCardScale.setValue(0.94);
    Animated.parallel([
      Animated.timing(discardOverlayOpacity, {
        duration: 180,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.spring(discardCardScale, {
        damping: 16,
        mass: 0.8,
        stiffness: 170,
        toValue: 1,
        useNativeDriver: true,
      }),
    ]).start();
  }, [discardCardScale, discardOverlayOpacity, pendingDiscardAction]);

  const handleLocationQueryChange = useCallback(
    (value: string) => {
      const sanitizedValue = sanitizeProfilePostLocationInput(value);
      setLocationQuery(sanitizedValue);
      setLocationSearchError(null);

      const normalizedQuery = sanitizedValue.trim().toLocaleLowerCase('tr-TR');
      const normalizedSelectedAddress = selectedLocation?.fullAddress
        .trim()
        .toLocaleLowerCase('tr-TR');
      const normalizedSelectedName = selectedLocation?.name
        .trim()
        .toLocaleLowerCase('tr-TR');
      if (
        selectedLocation &&
        normalizedQuery !== normalizedSelectedAddress &&
        normalizedQuery !== normalizedSelectedName
      ) {
        setSelectedLocation(null);
      }

      if (sanitizedValue.trim().length < LOCATION_AUTOCOMPLETE_MIN_QUERY_LENGTH) {
        setShowSuggestions(false);
        setLocationResults([]);
      } else if (locationInputFocusedRef.current) {
        setShowSuggestions(true);
      }
    },
    [selectedLocation],
  );

  const handleLocationInputFocus = useCallback(() => {
    locationInputFocusedRef.current = true;
    if (locationHideRef.current) {
      clearTimeout(locationHideRef.current);
      locationHideRef.current = null;
    }

    if (locationQuery.trim().length >= LOCATION_AUTOCOMPLETE_MIN_QUERY_LENGTH) {
      setShowSuggestions(true);
    }
  }, [locationQuery]);

  const handleLocationInputBlur = useCallback(() => {
    locationInputFocusedRef.current = false;
    if (locationHideRef.current) {
      clearTimeout(locationHideRef.current);
    }

    locationHideRef.current = setTimeout(() => {
      if (!locationSuggestionPressRef.current) {
        setShowSuggestions(false);
      }
    }, LOCATION_AUTOCOMPLETE_BLUR_CLOSE_DELAY_MS);
  }, []);

  const handleLocationSuggestionPressIn = useCallback(() => {
    locationSuggestionPressRef.current = true;
    if (locationHideRef.current) {
      clearTimeout(locationHideRef.current);
      locationHideRef.current = null;
    }
  }, []);

  const handleLocationSuggestionPressOut = useCallback(() => {
    setTimeout(() => {
      locationSuggestionPressRef.current = false;
    }, 0);
  }, []);

  const handleSelectLocationSuggestion = useCallback(
    (suggestion: LocationAutocompleteResult) => {
      const selected = mapLocationAutocompleteResultToSelectedLocation(suggestion);
      suppressNextAutocompleteFetchRef.current = true;
      setSelectedLocation(selected);
      setLocationQuery(sanitizeProfilePostLocationInput(selected.fullAddress));
      setShowSuggestions(false);
      setLocationSearchError(null);
    },
    [],
  );

  useEffect(() => {
    if (!visible) {
      if (locationDebounceRef.current) {
        clearTimeout(locationDebounceRef.current);
        locationDebounceRef.current = null;
      }
      if (locationRequestAbortRef.current) {
        locationRequestAbortRef.current.abort();
        locationRequestAbortRef.current = null;
      }
      setLoadingLocations(false);
      return;
    }

    const query = locationQuery.trim();
    if (query.length < LOCATION_AUTOCOMPLETE_MIN_QUERY_LENGTH) {
      if (locationDebounceRef.current) {
        clearTimeout(locationDebounceRef.current);
        locationDebounceRef.current = null;
      }
      if (locationRequestAbortRef.current) {
        locationRequestAbortRef.current.abort();
        locationRequestAbortRef.current = null;
      }
      setLoadingLocations(false);
      setLocationSearchError(null);
      return;
    }

    if (suppressNextAutocompleteFetchRef.current) {
      suppressNextAutocompleteFetchRef.current = false;
      return;
    }

    if (locationDebounceRef.current) {
      clearTimeout(locationDebounceRef.current);
      locationDebounceRef.current = null;
    }

    const requestId = locationRequestIdRef.current + 1;
    locationRequestIdRef.current = requestId;
    locationDebounceRef.current = setTimeout(() => {
      if (locationRequestAbortRef.current) {
        locationRequestAbortRef.current.abort();
      }

      const controller = new AbortController();
      locationRequestAbortRef.current = controller;
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, LOCATION_AUTOCOMPLETE_TIMEOUT_MS);

      setLoadingLocations(true);
      setLocationSearchError(null);

      searchMapboxLocations(query, {
        limit: LOCATION_AUTOCOMPLETE_LIMIT,
        signal: controller.signal,
      })
        .then(results => {
          if (requestId !== locationRequestIdRef.current) {
            return;
          }
          setLocationResults(results);
          if (locationInputFocusedRef.current) {
            setShowSuggestions(true);
          }
        })
        .catch(error => {
          if (requestId !== locationRequestIdRef.current) {
            return;
          }
          if (controller.signal.aborted) {
            return;
          }
          setLocationResults([]);
          setLocationSearchError(
            resolveErrorMessage(error, 'Konum onerileri su an yuklenemedi.'),
          );
          if (locationInputFocusedRef.current) {
            setShowSuggestions(true);
          }
        })
        .finally(() => {
          clearTimeout(timeoutId);
          if (requestId === locationRequestIdRef.current) {
            setLoadingLocations(false);
          }
        });
    }, LOCATION_AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      if (locationDebounceRef.current) {
        clearTimeout(locationDebounceRef.current);
        locationDebounceRef.current = null;
      }
      if (locationRequestAbortRef.current) {
        locationRequestAbortRef.current.abort();
        locationRequestAbortRef.current = null;
      }
    };
  }, [locationQuery, visible]);

  const handleTrendingTagBrowserQueryChange = useCallback((value: string) => {
    setTrendingTagBrowserQuery(value.replace(/\s+/g, ' ').slice(0, 48));
    setTrendingTagBrowserError(null);
  }, []);

  const closeTrendingTagBrowser = useCallback(() => {
    trendingTagBrowserRequestIdRef.current += 1;
    trendingTagDetailRequestIdRef.current += 1;
    setIsTrendingTagBrowserVisible(false);
    setTrendingTagBrowserError(null);
    setIsLoadingTrendingTagBrowser(false);
    setActiveTrendingTagKey(null);
    setActiveTrendingTagDetail(null);
    setIsLoadingTrendingTagDetail(false);
    setTrendingTagDetailError(null);
    setTrendingTagDetailTab('top');
  }, []);

  const openTrendingTagBrowser = useCallback(
    (initialQuery?: string) => {
      const normalizedQuery = normalizeTrendingTagKey(
        initialQuery ?? activeHashtagContext?.rawQuery ?? '',
      );
      setTrendingTagBrowserQuery(normalizedQuery);
      setTrendingTagBrowserResults(
        normalizedQuery.length === 0
          ? suggestedTags.slice(0, TRENDING_TAG_BROWSER_LIMIT)
          : [],
      );
      setTrendingTagBrowserError(null);
      setActiveTrendingTagKey(null);
      setActiveTrendingTagDetail(null);
      setIsLoadingTrendingTagDetail(false);
      setTrendingTagDetailError(null);
      setTrendingTagDetailTab('top');
      setIsTrendingTagBrowserVisible(true);
    },
    [activeHashtagContext?.rawQuery, suggestedTags],
  );

  const handleTrendingTagSuggestionOpen = useCallback(
    (rawTag: string) => {
      const normalizedTag = normalizeTrendingTagKey(rawTag);
      if (!normalizedTag) {
        return;
      }

      setActiveTrendingTagKey(normalizedTag);
      setActiveTrendingTagDetail(null);
      setIsLoadingTrendingTagDetail(true);
      setTrendingTagDetailError(null);
      setTrendingTagDetailTab('top');

      const requestId = trendingTagDetailRequestIdRef.current + 1;
      trendingTagDetailRequestIdRef.current = requestId;

      fetchExploreTagDetail(normalizedTag, { limit: TRENDING_TAG_DETAIL_POST_LIMIT })
        .then(response => {
          if (requestId !== trendingTagDetailRequestIdRef.current) {
            return;
          }
          setActiveTrendingTagDetail(response);
        })
        .catch(error => {
          if (requestId !== trendingTagDetailRequestIdRef.current) {
            return;
          }
          setTrendingTagDetailError(
            resolveErrorMessage(error, 'Etiket sayfasi su an acilamadi.'),
          );
        })
        .finally(() => {
          if (requestId === trendingTagDetailRequestIdRef.current) {
            setIsLoadingTrendingTagDetail(false);
          }
        });
    },
    [],
  );

  const closeTrendingTagDetail = useCallback(() => {
    trendingTagDetailRequestIdRef.current += 1;
    setActiveTrendingTagKey(null);
    setActiveTrendingTagDetail(null);
    setIsLoadingTrendingTagDetail(false);
    setTrendingTagDetailError(null);
    setTrendingTagDetailTab('top');
  }, []);

  const applyTrendingTagFromBrowser = useCallback(
    (tag: string) => {
      if (isCreateMode && activeHashtagContext) {
        const applied = applyHashtagSuggestion(caption, activeHashtagContext, tag);
        setCaption(applied.nextValue);
        setCaptionSelection({ end: applied.nextCursor, start: applied.nextCursor });
      } else {
        setCaption(previous => appendHashtagToCaption(previous, tag));
      }
      closeTrendingTagBrowser();
    },
    [activeHashtagContext, caption, closeTrendingTagBrowser, isCreateMode],
  );

  useEffect(() => {
    if (!visible || !isTrendingTagBrowserVisible || activeTrendingTagKey) {
      if (trendingTagBrowserDebounceRef.current) {
        clearTimeout(trendingTagBrowserDebounceRef.current);
        trendingTagBrowserDebounceRef.current = null;
      }
      setIsLoadingTrendingTagBrowser(false);
      return;
    }

    if (trendingTagBrowserDebounceRef.current) {
      clearTimeout(trendingTagBrowserDebounceRef.current);
      trendingTagBrowserDebounceRef.current = null;
    }

    const normalizedQuery = normalizeTrendingTagKey(trendingTagBrowserQuery);
    const requestId = trendingTagBrowserRequestIdRef.current + 1;
    trendingTagBrowserRequestIdRef.current = requestId;
    trendingTagBrowserDebounceRef.current = setTimeout(() => {
      setIsLoadingTrendingTagBrowser(true);
      setTrendingTagBrowserError(null);
      fetchExploreTrendingTags({
        limit: TRENDING_TAG_BROWSER_LIMIT,
        query: normalizedQuery.length > 0 ? normalizedQuery : undefined,
      })
        .then(response => {
          if (requestId !== trendingTagBrowserRequestIdRef.current) {
            return;
          }
          setTrendingTagBrowserResults(response.tags);
        })
        .catch(error => {
          if (requestId !== trendingTagBrowserRequestIdRef.current) {
            return;
          }
          setTrendingTagBrowserResults([]);
          setTrendingTagBrowserError(
            resolveErrorMessage(error, 'Trend etiketler su an yuklenemedi.'),
          );
        })
        .finally(() => {
          if (requestId === trendingTagBrowserRequestIdRef.current) {
            setIsLoadingTrendingTagBrowser(false);
          }
        });
    }, TRENDING_TAG_BROWSER_DEBOUNCE_MS);

    return () => {
      if (trendingTagBrowserDebounceRef.current) {
        clearTimeout(trendingTagBrowserDebounceRef.current);
        trendingTagBrowserDebounceRef.current = null;
      }
    };
  }, [activeTrendingTagKey, isTrendingTagBrowserVisible, trendingTagBrowserQuery, visible]);

  const normalizedCaption = useMemo(
    () => normalizeProfilePostCaption(caption),
    [caption],
  );
  const normalizedLocation = useMemo(
    () => normalizeProfilePostLocation(locationQuery),
    [locationQuery],
  );
  const validationMessage = useMemo(
    () =>
      validateProfilePostInput({
        caption: normalizedCaption,
        location: normalizedLocation,
        mediaType: draft?.mediaType,
        mediaUrl: draft?.mediaUrl,
      }),
    [draft?.mediaType, draft?.mediaUrl, normalizedCaption, normalizedLocation],
  );
  const extractedCaptionTags = useMemo(
    () => extractProfilePostHashtags(caption),
    [caption],
  );
  const availableSuggestedTags = useMemo(() => {
    if (suggestedTags.length === 0) {
      return [];
    }
    return suggestedTags
      .filter(item => !extractedCaptionTags.includes(item.tag.toLocaleLowerCase('tr-TR')))
      .slice(0, TRENDING_TAG_SUGGESTION_LIMIT);
  }, [extractedCaptionTags, suggestedTags]);
  const shouldShowCreateTagSuggestions =
    isCreateMode && isCaptionFocused && Boolean(activeHashtagContext);
  const inlineHashtagSuggestions = shouldShowCreateTagSuggestions
    ? availableSuggestedTags
    : [];
  const activeTrendingTagPosts = useMemo(
    () =>
      trendingTagDetailTab === 'top'
        ? activeTrendingTagDetail?.topPosts ?? []
        : activeTrendingTagDetail?.recentPosts ?? [],
    [activeTrendingTagDetail, trendingTagDetailTab],
  );
  const handleHashtagSuggestionPress = useCallback(
    (tag: string) => {
      if (isCreateMode && activeHashtagContext) {
        const applied = applyHashtagSuggestion(caption, activeHashtagContext, tag);
        setCaption(applied.nextValue);
        setCaptionSelection({ end: applied.nextCursor, start: applied.nextCursor });
        return;
      }
      setCaption(previous => appendHashtagToCaption(previous, tag));
    },
    [activeHashtagContext, caption, isCreateMode],
  );
  const locationPayload = useMemo(
    () =>
      normalizedLocation.length > 0
        ? buildPostLocationPayload({
            locationQuery,
            normalizedLocation,
            selectedLocation,
          })
        : undefined,
    [locationQuery, normalizedLocation, selectedLocation],
  );
  const selectedLocationDisplay = useMemo(() => {
    if (!selectedLocation) {
      return '';
    }
    const fullAddress = selectedLocation.fullAddress.trim();
    const name = selectedLocation.name.trim();
    if (fullAddress.length > 0) {
      return fullAddress;
    }
    return name;
  }, [selectedLocation]);

  const isDirty = useMemo(() => {
    if (mode === 'edit') {
      return (
        normalizedCaption !== initialSnapshot.caption ||
        normalizedLocation !== initialSnapshot.location ||
        visibility !== initialSnapshot.visibility
      );
    }

    return (
      normalizedCaption.length > 0 ||
      normalizedLocation.length > 0 ||
      visibility !== 'public'
    );
  }, [
    initialSnapshot.caption,
    initialSnapshot.location,
    initialSnapshot.visibility,
    mode,
    normalizedCaption,
    normalizedLocation,
    visibility,
  ]);

  const canSubmit = useMemo(() => {
    if (!draft?.mediaUrl || isSubmitting || Boolean(validationMessage)) {
      return false;
    }

    if (mode === 'create' && normalizedCaption.length === 0) {
      return false;
    }

    if (mode === 'edit' && !isDirty) {
      return false;
    }

    return true;
  }, [
    draft?.mediaUrl,
    isDirty,
    isSubmitting,
    mode,
    normalizedCaption.length,
    validationMessage,
  ]);

  const discardPromptTitle =
    mode === 'edit' ? 'Değişiklikler silinsin mi?' : 'Taslak kapatılsın mı?';
  const discardPromptMessage =
    mode === 'edit'
      ? 'Kaydetmediğiniz değişiklikler kaybolacak.'
      : 'Paylaşmadığınız değişiklikler kaybolacak.';

  const closeDiscardPrompt = useCallback(() => {
    setPendingDiscardAction(null);
  }, []);

  const confirmDiscardPrompt = useCallback(() => {
    const action = pendingDiscardAction;
    setPendingDiscardAction(null);
    if (action === 'back' && onBackToCamera) {
      onBackToCamera();
      return;
    }
    onClose();
  }, [onBackToCamera, onClose, pendingDiscardAction]);

  function handleDismiss() {
    if (isSubmitting) {
      return;
    }

    if (!isDirty) {
      onClose();
      return;
    }

    setPendingDiscardAction('close');
  }

  function handleBackAction() {
    if (!onBackToCamera) {
      handleDismiss();
      return;
    }
    if (isSubmitting) {
      return;
    }

    if (!isDirty) {
      onBackToCamera();
      return;
    }

    setPendingDiscardAction('back');
  }

  async function handleSubmit() {
    if (!draft || !canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      if (mode === 'edit' && postId) {
        await updateProfilePost(postId, {
          caption: normalizedCaption,
          location: normalizedLocation || undefined,
          locationPayload,
          visibility,
        });
      } else {
        await onSubmit(
          {
            caption: normalizedCaption,
            location: normalizedLocation || undefined,
            locationPayload,
            mediaType: draft.mediaType,
            mediaUrl: draft.mediaUrl,
            thumbnailUrl: draft.thumbnailUrl,
            visibility,
          },
          {
            onProgress: progress => {
              setSubmitProgress(progress.progress);
              setSubmitMessage(progress.message);
            },
          },
        );
      }
      onClose();
    } catch (error) {
      const message = resolveErrorMessage(
        error,
          'Paylaşım Tamamlanamadı, tekrar deneyin.',
      );
      if (mode === 'create') {
        showToast({
          message,
          title: 'Paylaşım Tamamlanamadı',
          tone: 'danger',
        });
        return;
      }
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const createHeaderTopInset = Math.max(safeTop, 14) + 8;
  const topInset = Math.max(safeTop, 8) + 6;
  const bottomInset = Math.max(safeBottom, 12);
  const sourceLabel = resolveSourceLabel(draft?.source);
  const headerTitle = mode === 'edit' ? 'Gönderiyi Düzenle' : 'Yeni Gönderi';
  const submitLabel = mode === 'edit' ? 'Kaydet' : 'Paylaş';
  const isSubmitButtonActive = canSubmit || isSubmitting;
  const displayName =
    viewerDisplayName && viewerDisplayName.trim().length > 0
      ? viewerDisplayName.trim()
      : 'Sen';
  const handleModalRequestClose = () => {
    if (pendingDiscardAction) {
      closeDiscardPrompt();
      return;
    }
    handleDismiss();
  };

  const content = (
    <View style={styles.screen}>
        <StatusBar
          animated={true}
          backgroundColor="transparent"
          barStyle="dark-content"
          hidden={false}
          translucent={true}
        />
        {isCreateMode ? (
          <View style={[styles.createHeader, { paddingTop: createHeaderTopInset }]}>
            <View style={styles.createHeaderRow}>
              <Pressable
                disabled={isSubmitting}
                onPress={handleBackAction}
                style={styles.createBackButton}
              >
                <FeatherIcon color="#0f172a" name="chevron-left" size={24} />
              </Pressable>

              <View pointerEvents="none" style={styles.createHeaderTitleWrap}>
                <Text style={styles.createHeaderTitle}>{headerTitle}</Text>
              </View>

              <Pressable
                disabled={!canSubmit}
                onPress={() => {
                  handleSubmit().catch(() => {
                    return;
                  });
                }}
                style={[
                  styles.createSubmitButton,
                  isSubmitButtonActive ? styles.createSubmitButtonEnabled : null,
                ]}
              >
                {isSubmitting ? (
                  <IosSpinner color="#ffffff" size="small" />
                ) : (
                  <Text
                    style={[
                      styles.createSubmitText,
                      isSubmitButtonActive ? styles.createSubmitTextEnabled : null,
                    ]}
                  >
                    {submitLabel}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={[styles.header, { paddingTop: topInset }]}>
            <View style={styles.headerRow}>
              <Pressable
                disabled={isSubmitting}
                onPress={handleBackAction}
                style={styles.headerIconButton}
              >
                <FeatherIcon
                  color="#111827"
                  name={onBackToCamera ? 'chevron-left' : 'x'}
                  size={24}
                />
              </Pressable>

              <View style={styles.headerMeta}>
                <Text style={styles.headerTitle}>{headerTitle}</Text>
                <Text style={styles.headerSubtitle}>
                  Açıklama, konum ve gorunurluk ayarlarini guncelle.
                </Text>
              </View>

              <Pressable
                disabled={!canSubmit}
                onPress={() => {
                  handleSubmit().catch(() => {
                    return;
                  });
                }}
                style={[
                  styles.headerSubmitButton,
                  canSubmit ? styles.headerSubmitButtonEnabled : null,
                ]}
              >
                {isSubmitting ? (
                  <IosSpinner color="#ffffff" size="small" />
                ) : (
                  <Text
                    style={[
                      styles.headerSubmitText,
                      canSubmit ? styles.headerSubmitTextEnabled : null,
                    ]}
                  >
                    {submitLabel}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        )}
        <View style={styles.headerDivider} />

        <KeyboardAwareScrollView
          bounces={!isCreateMode}
          contentContainerStyle={[
            isCreateMode
              ? [
                  styles.createScrollContentCompact,
                  { paddingBottom: Math.max(bottomInset, 10) + 18 },
                ]
              : [styles.scrollContent, { paddingBottom: bottomInset + 150 }],
          ]}
          enableAutomaticScroll
          enableOnAndroid
          extraScrollHeight={isCreateMode ? 96 : 140}
          keyboardOpeningTime={0}
          keyboardShouldPersistTaps={isCreateMode ? 'always' : 'handled'}
          onScrollBeginDrag={() => {
            setShowSuggestions(false);
          }}
          scrollEnabled={true}
          showsVerticalScrollIndicator={false}
        >
          {isCreateMode ? (
            <>
              <View style={styles.createComposerRowCompact}>
                <View style={styles.createAvatarWrap}>
                  {viewerAvatarUrl && viewerAvatarUrl.trim().length > 0 ? (
                    <Image source={{ uri: viewerAvatarUrl }} style={styles.avatarImage} />
                  ) : (
                    <FeatherIcon color="#9ca3af" name="user" size={17} />
                  )}
                </View>
                <TextInput
                  maxLength={PROFILE_POST_CAPTION_MAX_LENGTH}
                  multiline
                  onBlur={() => {
                    setIsCaptionFocused(false);
                  }}
                  onChangeText={value => {
                    setCaption(sanitizeProfilePostCaptionInput(value));
                  }}
                  onFocus={() => {
                    setIsCaptionFocused(true);
                  }}
                  onSelectionChange={event => {
                    setCaptionSelection(event.nativeEvent.selection);
                  }}
                  placeholder="Gönderin Hakkında Bir Şeyler Yaz..."
                  placeholderTextColor="#9ca3af"
                  selection={captionSelection}
                  style={styles.createCaptionInputCompact}
                  value={caption}
                />
                <View style={styles.createPreviewWrapCompact}>
                  <AppMedia
                    durationLabelMode="remaining"
                    enableVideoPreviewInThumbnail={draft?.mediaType === 'video'}
                    mediaType={draft?.mediaType}
                    mediaUrl={draft?.mediaUrl ?? ''}
                    mode="thumbnail"
                    previewLoopFromOffset={true}
                    previewStartOffsetSec={2}
                    showVideoBadge={draft?.mediaType === 'video'}
                    showVideoDurationLabel={draft?.mediaType === 'video'}
                    showVideoTypePill={draft?.mediaType === 'video'}
                    style={styles.createPreviewMedia}
                    thumbnailUrl={draft?.thumbnailUrl}
                  />
                </View>
              </View>

              {shouldShowCreateTagSuggestions ? (
                <View style={styles.inlineTagPanel}>
                  <View style={styles.inlineTagPanelHeader}>
                    <Text style={styles.inlineTagPanelTitle}>Trend etiketler</Text>
                    <Pressable
                      onPress={() => {
                        openTrendingTagBrowser(activeHashtagContext?.rawQuery);
                      }}
                      style={styles.inlineTagOpenButton}
                    >
                      <Text style={styles.inlineTagOpenButtonText}>Tümünü Gor</Text>
                    </Pressable>
                  </View>
                  {isLoadingSuggestedTags ? (
                    <View style={styles.inlineTagPanelState}>
                      <IosSpinner color="#f97316" size="small" />
                      <Text style={styles.inlineTagPanelStateText}>
                        Etiketler yukleniyor...
                      </Text>
                    </View>
                  ) : suggestedTagsError ? (
                    <View style={styles.inlineTagPanelState}>
                      <Text style={styles.inlineTagPanelErrorText}>
                        {suggestedTagsError}
                      </Text>
                    </View>
                  ) : inlineHashtagSuggestions.length > 0 ? (
                    <ScrollView
                      horizontal={true}
                      keyboardShouldPersistTaps="always"
                      showsHorizontalScrollIndicator={false}
                    >
                      <View style={styles.inlineTagSuggestionRow}>
                        {inlineHashtagSuggestions.map(item => (
                          <Pressable
                            key={item.tag}
                            onPress={() => {
                              handleHashtagSuggestionPress(item.tag);
                            }}
                            style={styles.inlineTagSuggestionChip}
                          >
                            <Text style={styles.inlineTagSuggestionChipText}>
                              #{item.tag}
                            </Text>
                            <Text style={styles.inlineTagSuggestionChipMeta}>
                              {formatTrendingTagMeta(item)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  ) : (
                    <View style={styles.inlineTagPanelState}>
                      <Text style={styles.inlineTagPanelStateText}>
                        Etiket bulunamadi.
                      </Text>
                    </View>
                  )}
                </View>
              ) : null}

              <View style={[styles.createLocationSectionCompact, styles.locationSection]}>
                <View style={styles.createLocationHeaderRowCompact}>
                  <Text style={styles.createPrivacyTitle}>KONUM</Text>
                  <Text style={styles.counterText}>
                    {sanitizeProfilePostLocationInput(locationQuery).length}/
                    {PROFILE_POST_LOCATION_MAX_LENGTH}
                  </Text>
                </View>
                <LocationAutocomplete
                  errorMessage={locationSearchError}
                  loadingLocations={loadingLocations}
                  locationQuery={locationQuery}
                  locationResults={locationResults}
                  maxLength={PROFILE_POST_LOCATION_MAX_LENGTH}
                  onInputBlur={handleLocationInputBlur}
                  onInputFocus={handleLocationInputFocus}
                  onLocationQueryChange={handleLocationQueryChange}
                  onSelectLocation={handleSelectLocationSuggestion}
                  onSuggestionPressIn={handleLocationSuggestionPressIn}
                  onSuggestionPressOut={handleLocationSuggestionPressOut}
                  placeholder="Konumunuzu girin"
                  selectedLocation={selectedLocation}
                  showSuggestions={showSuggestions}
                />
                {selectedLocation ? (
                  <Text style={styles.createLocationMetaCompact}>
                    Secilen konum: {selectedLocationDisplay}
                  </Text>
                ) : null}
              </View>

              <View style={styles.createDividerCompact} />

              <View style={styles.createPrivacySectionCompact}>
                <View style={styles.createPrivacyHeaderCompact}>
                  <Text style={styles.createPrivacyTitle}>GIZLILIK</Text>
                </View>
                <View style={styles.createPrivacyListCompact}>
                  {visibilityOptions.map(option => {
                    const selected = visibility === option.key;
                    return (
                      <Pressable
                        key={option.key}
                        onPress={() => {
                          setVisibility(option.key);
                        }}
                        style={[
                          styles.createOptionRowCompact,
                          selected ? styles.createOptionRowCompactSelected : null,
                        ]}
                      >
                        <View style={styles.createOptionLeft}>
                          <View
                            style={[
                              styles.createOptionIconWrap,
                              selected
                                ? styles.createOptionIconWrapSelected
                                : styles.createOptionIconWrapIdle,
                            ]}
                          >
                            <FeatherIcon
                              color={selected ? '#f97316' : '#4b5563'}
                              name={option.icon}
                              size={18}
                            />
                          </View>
                          <View style={styles.createOptionTextWrap}>
                            <Text
                              style={[
                                styles.createOptionTitle,
                                selected ? styles.createOptionTitleSelected : null,
                              ]}
                            >
                              {option.title}
                            </Text>
                            <Text style={styles.createOptionDescription}>
                              {option.description}
                            </Text>
                          </View>
                        </View>
                        <View
                          style={[
                            styles.createOptionCheckCompact,
                            selected
                              ? styles.createOptionCheckCompactSelected
                              : styles.createOptionCheckCompactIdle,
                          ]}
                        >
                          {selected ? (
                            <FeatherIcon color="#ffffff" name="check" size={13} />
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                {viewerIsPrivateAccount ? (
                  <View style={styles.privateAccountVisibilityNoteCard}>
                    <View style={styles.privateAccountVisibilityNoteIconWrap}>
                      <FeatherIcon color="#ea580c" name="shield" size={13} />
                    </View>
                    <Text style={styles.privateAccountVisibilityNote}>
                      Hesabin gizli oldugu icin gonderilerin yalnizca takipcilerin tarafindan
                      goruntulenebilir.
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <View style={styles.summaryCard}>
                <View style={styles.summaryTopRow}>
                  <View style={styles.summaryIdentity}>
                    <View style={styles.avatarWrap}>
                      {viewerAvatarUrl && viewerAvatarUrl.trim().length > 0 ? (
                        <Image
                          source={{ uri: viewerAvatarUrl }}
                          style={styles.avatarImage}
                        />
                      ) : (
                        <FeatherIcon color="#94a3b8" name="user" size={18} />
                      )}
                    </View>
                    <View style={styles.summaryIdentityText}>
                      <Text style={styles.summaryTitle}>{displayName}</Text>
                      <Text style={styles.summarySubtitle}>
                        {draft?.mediaType === 'video'
                          ? 'Video Paylaşımı'
                          : 'Fotoğraf Paylaşımı'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.summaryChip}>
                    <FeatherIcon color="#ea580c" name="camera" size={12} />
                    <Text style={styles.summaryChipText}>{sourceLabel}</Text>
                  </View>
                </View>

                <View style={styles.summaryPreviewWrap}>
                  <AppMedia
                    durationLabelMode="remaining"
                    enableVideoPreviewInThumbnail={draft?.mediaType === 'video'}
                    mediaType={draft?.mediaType}
                    mediaUrl={draft?.mediaUrl ?? ''}
                    mode="thumbnail"
                    previewLoopFromOffset={true}
                    previewStartOffsetSec={2}
                    showVideoBadge={draft?.mediaType === 'video'}
                    showVideoDurationLabel={draft?.mediaType === 'video'}
                    showVideoTypePill={draft?.mediaType === 'video'}
                    style={styles.summaryPreviewMedia}
                    thumbnailUrl={draft?.thumbnailUrl}
                  />
                </View>
              </View>

              <View style={styles.formSection}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Aciklama</Text>
                  <Text style={styles.counterText}>
                    {sanitizeProfilePostCaptionInput(caption).length}/
                    {PROFILE_POST_CAPTION_MAX_LENGTH}
                  </Text>
                </View>
                <TextInput
                  maxLength={PROFILE_POST_CAPTION_MAX_LENGTH}
                  multiline
                  onChangeText={value => {
                    setCaption(sanitizeProfilePostCaptionInput(value));
                  }}
                  placeholder="Gönderinle ilgili kısa ama güçlü bir açıklama ekle..."
                  placeholderTextColor="#94a3b8"
                  style={[styles.input, styles.captionInput]}
                  value={caption}
                />
              </View>

              <View style={styles.formSection}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Etiketler</Text>
                  <Text style={styles.counterText}>
                    {extractedCaptionTags.length}/{PROFILE_POST_HASHTAG_MAX_COUNT}
                  </Text>
                </View>
                {extractedCaptionTags.length > 0 ? (
                  <View style={styles.tagChipRow}>
                    {extractedCaptionTags.map(tag => (
                      <View key={tag} style={styles.currentTagChip}>
                        <Text style={styles.currentTagChipText}>#{tag}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.helperText}>
                    Trend etiketi eklemek istersen #bogaz gibi yazabilir veya
                    aşağıdaki önerilere dokunabilirsin.
                  </Text>
                )}
                {isLoadingSuggestedTags ? (
                  <View style={styles.tagLoadingRow}>
                    <IosSpinner color="#f97316" size="small" />
                  </View>
                ) : null}
                {!isLoadingSuggestedTags && suggestedTagsError ? (
                  <Text style={styles.inlineErrorText}>{suggestedTagsError}</Text>
                ) : null}
                {!isLoadingSuggestedTags &&
                !suggestedTagsError &&
                availableSuggestedTags.length > 0 ? (
                  <View style={styles.tagChipRow}>
                    {availableSuggestedTags.map(item => (
                      <Pressable
                        key={item.tag}
                        onPress={() => {
                          setCaption(previous =>
                            appendHashtagToCaption(previous, item.tag),
                          );
                        }}
                        style={styles.tagSuggestionChip}
                      >
                        <Text style={styles.tagSuggestionChipText}>
                          #{item.tag}
                        </Text>
                        <Text style={styles.tagSuggestionChipMeta}>
                          {formatTrendingTagMeta(item)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Pressable
                  onPress={() => {
                    openTrendingTagBrowser();
                  }}
                  style={styles.trendingTagBrowseAction}
                >
                  <Text style={styles.trendingTagBrowseActionText}>
                    Trend etiket akışına git
                  </Text>
                  <FeatherIcon color="#64748b" name="chevron-right" size={16} />
                </Pressable>
              </View>

              <View style={[styles.formSection, styles.locationSection]}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Konum</Text>
                  <Text style={styles.counterText}>
                    {sanitizeProfilePostLocationInput(locationQuery).length}/
                    {PROFILE_POST_LOCATION_MAX_LENGTH}
                  </Text>
                </View>
                <LocationAutocomplete
                  errorMessage={locationSearchError}
                  loadingLocations={loadingLocations}
                  locationQuery={locationQuery}
                  locationResults={locationResults}
                  maxLength={PROFILE_POST_LOCATION_MAX_LENGTH}
                  onInputBlur={handleLocationInputBlur}
                  onInputFocus={handleLocationInputFocus}
                  onLocationQueryChange={handleLocationQueryChange}
                  onSelectLocation={handleSelectLocationSuggestion}
                  onSuggestionPressIn={handleLocationSuggestionPressIn}
                  onSuggestionPressOut={handleLocationSuggestionPressOut}
                  placeholder="Konumunuzu girin"
                  selectedLocation={selectedLocation}
                  showSuggestions={showSuggestions}
                />
                {selectedLocation ? (
                  <Text style={styles.locationSelectionMeta}>
                    Secilen konum: {selectedLocationDisplay}
                  </Text>
                ) : null}
              </View>

              <View style={styles.formSection}>
                <Text style={styles.sectionTitle}>Gorunurluk</Text>
                <View style={styles.optionList}>
                  {visibilityOptions.map(option => {
                    const selected = visibility === option.key;
                    return (
                      <Pressable
                        key={option.key}
                        onPress={() => {
                          setVisibility(option.key);
                        }}
                        style={[
                          styles.optionRow,
                          selected ? styles.optionRowSelected : null,
                        ]}
                      >
                        <View style={styles.optionLeft}>
                          <View
                            style={[
                              styles.optionIconWrap,
                              selected ? styles.optionIconWrapSelected : null,
                            ]}
                          >
                            <FeatherIcon
                              color={selected ? '#f97316' : '#64748b'}
                              name={option.icon}
                              size={18}
                            />
                          </View>
                          <View style={styles.optionTextWrap}>
                            <Text
                              style={[
                                styles.optionTitle,
                                selected ? styles.optionTitleSelected : null,
                              ]}
                            >
                              {option.title}
                            </Text>
                            <Text style={styles.optionDescription}>
                              {option.description}
                            </Text>
                          </View>
                        </View>
                        {selected ? (
                          <View style={styles.optionCheckFilled}>
                            <FeatherIcon color="#ffffff" name="check" size={15} />
                          </View>
                        ) : (
                          <View style={styles.optionCheckOutline} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
                {viewerIsPrivateAccount ? (
                  <View style={styles.privateAccountVisibilityNoteCard}>
                    <View style={styles.privateAccountVisibilityNoteIconWrap}>
                      <FeatherIcon color="#ea580c" name="shield" size={13} />
                    </View>
                    <Text style={styles.privateAccountVisibilityNote}>
                      Hesabin gizli oldugu icin gonderilerin yalnizca takipcilerin tarafindan
                      goruntulenebilir.
                    </Text>
                  </View>
                ) : null}
              </View>
            </>
          )}
        </KeyboardAwareScrollView>

        <Modal
          animationType="slide"
          onRequestClose={() => {
            if (activeTrendingTagKey) {
              closeTrendingTagDetail();
              return;
            }
            closeTrendingTagBrowser();
          }}
          statusBarTranslucent={false}
          transparent={true}
          visible={isTrendingTagBrowserVisible}
        >
          <StatusBar
            animated={true}
            backgroundColor="#ffffff"
            barStyle="dark-content"
            hidden={false}
            translucent={false}
          />
          <View style={styles.trendingTagModalRoot}>
            <Pressable
              onPress={closeTrendingTagBrowser}
              style={styles.trendingTagModalBackdrop}
            />
            <View
              style={[
                styles.trendingTagModalSheet,
                {
                  paddingBottom: Math.max(bottomInset, 14) + 2,
                  paddingTop: Math.max(safeTop, 8) + 6,
                },
              ]}
            >
              <View style={styles.trendingTagModalHeader}>
                {activeTrendingTagKey ? (
                  <Pressable
                    onPress={closeTrendingTagDetail}
                    style={styles.trendingTagIconButton}
                  >
                    <FeatherIcon color="#111827" name="chevron-left" size={20} />
                  </Pressable>
                ) : (
                  <View style={styles.trendingTagIconButtonPlaceholder} />
                )}
                <Text style={styles.trendingTagModalTitle}>
                  {activeTrendingTagKey ? `#${activeTrendingTagKey}` : 'Trend Etiketler'}
                </Text>
                <Pressable
                  onPress={closeTrendingTagBrowser}
                  style={styles.trendingTagIconButton}
                >
                  <FeatherIcon color="#111827" name="x" size={18} />
                </Pressable>
              </View>

              {!activeTrendingTagKey ? (
                <>
                  <View style={styles.trendingTagSearchRow}>
                    <FeatherIcon color="#6b7280" name="hash" size={15} />
                    <TextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={handleTrendingTagBrowserQueryChange}
                      placeholder="Etiket ara (orn. istanbul)"
                      placeholderTextColor="#9ca3af"
                      returnKeyType="search"
                      style={styles.trendingTagSearchInput}
                      value={trendingTagBrowserQuery}
                    />
                    {isLoadingTrendingTagBrowser ? (
                      <IosSpinner color="#f97316" size="small" />
                    ) : null}
                  </View>

                  {trendingTagBrowserError ? (
                    <View style={styles.trendingTagErrorCard}>
                      <Text style={styles.trendingTagErrorText}>
                        {trendingTagBrowserError}
                      </Text>
                    </View>
                  ) : null}

                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                    style={styles.trendingTagList}
                  >
                    {trendingTagBrowserResults.map(item => (
                      <Pressable
                        key={item.tag}
                        onPress={() => {
                          handleTrendingTagSuggestionOpen(item.tag);
                        }}
                        style={styles.trendingTagListItem}
                      >
                        <View style={styles.trendingTagListIconWrap}>
                          <FeatherIcon color="#ef4444" name="hash" size={15} />
                        </View>
                        <View style={styles.trendingTagListTextWrap}>
                          <Text style={styles.trendingTagListTitle}>#{item.tag}</Text>
                          <Text style={styles.trendingTagListMeta}>
                            {formatTrendingTagMeta(item)}
                          </Text>
                        </View>
                        <FeatherIcon color="#a5acb7" name="chevron-right" size={18} />
                      </Pressable>
                    ))}

                    {!isLoadingTrendingTagBrowser &&
                    !trendingTagBrowserError &&
                    trendingTagBrowserResults.length === 0 ? (
                      <View style={styles.trendingTagEmptyState}>
                        <Text style={styles.trendingTagEmptyStateText}>
                          Aramana uygun trend etiket bulunamadi.
                        </Text>
                      </View>
                    ) : null}
                  </ScrollView>
                </>
              ) : (
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  style={styles.trendingTagDetailScroll}
                >
                  {isLoadingTrendingTagDetail && !activeTrendingTagDetail ? (
                    <View style={styles.trendingTagDetailLoading}>
                      <IosSpinner color="#f97316" size="small" />
                      <Text style={styles.trendingTagDetailLoadingText}>
                        Etiket detaylari yukleniyor...
                      </Text>
                    </View>
                  ) : null}

                  {!isLoadingTrendingTagDetail && trendingTagDetailError ? (
                    <View style={styles.trendingTagErrorCard}>
                      <Text style={styles.trendingTagErrorText}>
                        {trendingTagDetailError}
                      </Text>
                    </View>
                  ) : null}

                  {activeTrendingTagDetail ? (
                    <>
                      <View style={styles.trendingTagDetailTopRow}>
                        <View>
                          <Text style={styles.trendingTagDetailName}>
                            #{activeTrendingTagDetail.tag.tag}
                          </Text>
                          <Text style={styles.trendingTagDetailSubtle}>
                            Son hareket:{' '}
                            {formatTrendingTagActivity(
                              activeTrendingTagDetail.tag.lastUsedAt,
                            )}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            applyTrendingTagFromBrowser(activeTrendingTagDetail.tag.tag);
                          }}
                          style={styles.trendingTagApplyButton}
                        >
                          <Text style={styles.trendingTagApplyButtonText}>
                            Etiketi Ekle
                          </Text>
                        </Pressable>
                      </View>

                      <View style={styles.trendingTagStatsRow}>
                        <View style={styles.trendingTagStatCard}>
                          <Text style={styles.trendingTagStatLabel}>Toplam</Text>
                          <Text style={styles.trendingTagStatValue}>
                            {formatCompactCount(activeTrendingTagDetail.tag.count)}
                          </Text>
                        </View>
                        <View style={styles.trendingTagStatCard}>
                          <Text style={styles.trendingTagStatLabel}>Son 48s</Text>
                          <Text style={styles.trendingTagStatValue}>
                            {formatCompactCount(
                              activeTrendingTagDetail.tag.recentCount,
                            )}
                          </Text>
                        </View>
                        <View style={styles.trendingTagStatCard}>
                          <Text style={styles.trendingTagStatLabel}>Skor</Text>
                          <Text style={styles.trendingTagStatValue}>
                            {formatCompactCount(activeTrendingTagDetail.tag.score)}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.trendingTagTabRow}>
                        <Pressable
                          onPress={() => {
                            setTrendingTagDetailTab('top');
                          }}
                          style={[
                            styles.trendingTagTabButton,
                            trendingTagDetailTab === 'top'
                              ? styles.trendingTagTabButtonActive
                              : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.trendingTagTabButtonText,
                              trendingTagDetailTab === 'top'
                                ? styles.trendingTagTabButtonTextActive
                                : null,
                            ]}
                          >
                            Öne Çıkanlar
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setTrendingTagDetailTab('recent');
                          }}
                          style={[
                            styles.trendingTagTabButton,
                            trendingTagDetailTab === 'recent'
                              ? styles.trendingTagTabButtonActive
                              : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.trendingTagTabButtonText,
                              trendingTagDetailTab === 'recent'
                                ? styles.trendingTagTabButtonTextActive
                                : null,
                            ]}
                          >
                            En Yeniler
                          </Text>
                        </Pressable>
                      </View>

                      {activeTrendingTagDetail.relatedTags.length > 0 ? (
                        <ScrollView
                          horizontal={true}
                          showsHorizontalScrollIndicator={false}
                          style={styles.trendingTagRelatedRow}
                        >
                          {activeTrendingTagDetail.relatedTags.map(item => (
                            <Pressable
                              key={item.tag}
                              onPress={() => {
                                handleTrendingTagSuggestionOpen(item.tag);
                              }}
                              style={styles.trendingTagRelatedChip}
                            >
                              <Text style={styles.trendingTagRelatedChipText}>
                                #{item.tag}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>
                      ) : null}

                      <View style={styles.trendingTagPostList}>
                        {activeTrendingTagPosts.map((post, index) => {
                          const shouldAutoPreviewVideo =
                            post.mediaType === 'video' && index < 2;

                          return (
                            <View key={post.id} style={styles.trendingTagPostCard}>
                              <View style={styles.trendingTagPostMediaWrap}>
                                <AppMedia
                                  durationLabelMode="remaining"
                                  enableVideoPreviewInThumbnail={shouldAutoPreviewVideo}
                                  mediaType={post.mediaType}
                                  mediaUrl={post.mediaUrl}
                                  mode="thumbnail"
                                  paused={
                                    post.mediaType === 'video' && !shouldAutoPreviewVideo
                                      ? true
                                      : undefined
                                  }
                                  previewLoopFromOffset={shouldAutoPreviewVideo}
                                  previewStartOffsetSec={
                                    shouldAutoPreviewVideo ? 2 : 0
                                  }
                                  showVideoBadge={post.mediaType === 'video'}
                                  showVideoDurationLabel={shouldAutoPreviewVideo}
                                  style={styles.trendingTagPostMedia}
                                />
                              </View>
                              <View style={styles.trendingTagPostBody}>
                                <Text numberOfLines={1} style={styles.trendingTagPostAuthor}>
                                  @{post.author.username}
                                </Text>
                                <Text
                                  numberOfLines={2}
                                  style={styles.trendingTagPostCaption}
                                >
                                  {post.caption && post.caption.trim().length > 0
                                    ? post.caption
                                    : 'Açıklama yok'}
                                </Text>
                              </View>
                            </View>
                          );
                        })}
                        {activeTrendingTagPosts.length === 0 ? (
                          <View style={styles.trendingTagEmptyState}>
                            <Text style={styles.trendingTagEmptyStateText}>
                              Bu sekmede gösterilecek gönderi bulunamadi.
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </>
                  ) : null}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {pendingDiscardAction ? (
          <Animated.View
            style={[styles.discardMessageOverlay, { opacity: discardOverlayOpacity }]}
          >
            <Pressable
              onPress={closeDiscardPrompt}
              style={styles.discardMessageBackdrop}
            />
            <Animated.View
              style={[
                styles.discardMessageCard,
                { transform: [{ scale: discardCardScale }] },
              ]}
            >
              <View style={styles.discardMessageHeaderRow}>
                <Text style={styles.discardMessageTitle}>{discardPromptTitle}</Text>
                <Pressable
                  hitSlop={10}
                  onPress={closeDiscardPrompt}
                  style={styles.discardMessageCloseButton}
                >
                  <FeatherIcon color="#6b7280" name="x" size={18} />
                </Pressable>
              </View>
              <Text style={styles.discardMessageText}>{discardPromptMessage}</Text>
              <View style={styles.discardMessageActions}>
                <Pressable onPress={closeDiscardPrompt} style={styles.discardGhostButton}>
                  <Text style={styles.discardGhostButtonText}>Vazgeç</Text>
                </Pressable>
                <Pressable
                  onPress={confirmDiscardPrompt}
                  style={styles.discardPrimaryButton}
                >
                  <Text style={styles.discardPrimaryButtonText}>Çık</Text>
                </Pressable>
              </View>
            </Animated.View>
          </Animated.View>
        ) : null}

        {validationMessage && !submitError ? (
          <View
            style={[styles.validationBanner, { bottom: bottomInset + 12 }]}
          >
            <Text style={styles.validationText}>{validationMessage}</Text>
          </View>
        ) : null}

        {submitError ? (
          <View style={[styles.errorBanner, { bottom: bottomInset + 12 }]}>
            <Text style={styles.errorText}>{submitError}</Text>
          </View>
        ) : null}

        {!isCreateMode && isSubmitting ? (
          <View style={[styles.progressCard, { bottom: bottomInset + 64 }]}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressTitle}>
                  {submitMessage || 'Paylaşım uygulanıp güncelleniyor...'}
              </Text>
              <Text style={styles.progressMeta}>
                %
                {Math.max(1, Math.min(100, Math.round(submitProgress * 100)))}
              </Text>
            </View>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${Math.max(8, Math.round(submitProgress * 100))}%`,
                  },
                ]}
              />
            </View>
          </View>
        ) : null}
    </View>
  );

  if (presentation === 'screen') {
    return visible ? content : null;
  }

  return (
    <Modal
      animationType="slide"
      navigationBarTranslucent={false}
      onRequestClose={handleModalRequestClose}
      presentationStyle="fullScreen"
      statusBarTranslucent={true}
      transparent={false}
      visible={visible}
    >
      {content}
    </Modal>
  );
}

const styles = StyleSheet.create({
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarWrap: {
    alignItems: 'center',
    backgroundColor: '#e2e8f0',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 40,
  },
  createAvatarWrap: {
    alignItems: 'center',
    backgroundColor: '#f2f4f7',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 44,
  },
  createBackButton: {
    alignItems: 'center',
    height: 34,
    justifyContent: 'center',
    marginLeft: 0,
    width: 34,
  },
  createCaptionInput: {
    color: '#111827',
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 10,
    minHeight: 152,
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
  createCaptionInputCompact: {
    color: '#111827',
    flex: 1,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    marginLeft: 12,
    maxHeight: 142,
    minHeight: 102,
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlignVertical: 'top',
  },
  createCaptionRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  createComposerLeft: {
    flex: 1,
    marginRight: 10,
    minHeight: 160,
  },
  createComposerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    minHeight: 190,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  createComposerRowCompact: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    minHeight: 156,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  createDivider: {
    backgroundColor: '#eceff3',
    height: 1,
    width: '100%',
  },
  createDividerCompact: {
    backgroundColor: '#eceff3',
    height: 1,
    marginTop: 10,
    width: '100%',
  },
  createFormSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  createHeader: {
    backgroundColor: '#ffffff',
    paddingBottom: 6,
    paddingHorizontal: 16,
  },
  createHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 50,
    position: 'relative',
  },
  createHeaderTitle: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '500',
  },
  createHeaderTitleWrap: {
    alignItems: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  createOptionCheckFilled: {
    alignItems: 'center',
    backgroundColor: '#f97316',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  createOptionCheckOutline: {
    borderColor: '#d1d5db',
    borderRadius: 14,
    borderWidth: 1.75,
    height: 28,
    width: 28,
  },
  createOptionCheckCompact: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  createOptionCheckCompactIdle: {
    backgroundColor: '#ffffff',
    borderColor: '#d1d5db',
  },
  createOptionCheckCompactSelected: {
    backgroundColor: '#f97316',
    borderColor: '#f97316',
  },
  createOptionDescription: {
    color: '#6b7280',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  createOptionIconWrap: {
    alignItems: 'center',
    backgroundColor: '#f2f4f7',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    marginRight: 12,
    width: 44,
  },
  createOptionIconWrapIdle: {
    backgroundColor: '#f2f4f7',
  },
  createOptionIconWrapSelected: {
    backgroundColor: '#fff1dd',
  },
  createOptionLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    marginRight: 12,
  },
  createOptionRow: {
    alignItems: 'center',
    borderBottomColor: '#e5e7eb',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 82,
    paddingVertical: 11,
  },
  createOptionRowCompact: {
    alignItems: 'center',
    borderBottomColor: '#eceff3',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 82,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  createOptionRowCompactSelected: {
    backgroundColor: '#fff1df',
    borderRadius: 0,
  },
  createOptionRowSelected: {
    backgroundColor: '#fff8ee',
  },
  createOptionTextWrap: {
    flexShrink: 1,
  },
  createOptionTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '400',
  },
  createOptionTitleSelected: {
    color: '#ea580c',
  },
  createPreviewMedia: {
    backgroundColor: '#dbe4f0',
    height: '100%',
    width: '100%',
  },
  createPreviewWrap: {
    borderRadius: 12,
    height: 128,
    overflow: 'hidden',
    width: 128,
  },
  createPreviewWrapCompact: {
    borderColor: '#e5eaf2',
    borderRadius: 14,
    borderWidth: 1,
    height: 108,
    marginLeft: 12,
    overflow: 'hidden',
    width: 108,
  },
  createPrivacyList: {
    marginTop: 10,
  },
  createPrivacyListCompact: {
    marginTop: 10,
  },
  createPrivacySection: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  createPrivacyHeaderCompact: {
    paddingHorizontal: 16,
  },
  createPrivacySectionCompact: {
    paddingHorizontal: 0,
    paddingTop: 16,
  },
  createPrivacyTitle: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.4,
  },
  createScrollContent: {
    flexGrow: 1,
    paddingTop: 0,
  },
  createScrollContentCompact: {
    flexGrow: 1,
    paddingTop: 0,
  },
  createSubmitButton: {
    alignItems: 'center',
    backgroundColor: '#fde7cf',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    minWidth: 104,
    paddingHorizontal: 21,
  },
  createSubmitButtonEnabled: {
    backgroundColor: '#f97316',
  },
  createSubmitText: {
    color: '#fff7ed',
    fontSize: 13,
    fontWeight: '700',
  },
  createSubmitTextEnabled: {
    color: '#ffffff',
    fontWeight: '800',
  },
  captionInput: {
    minHeight: 136,
    paddingTop: 14,
    textAlignVertical: 'top',
  },
  counterText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  discardGhostButton: {
    alignItems: 'center',
    borderColor: '#d1d5db',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minWidth: 92,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  discardGhostButtonText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '500',
  },
  discardMessageActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  discardMessageBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.22)',
  },
  discardMessageCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    maxWidth: 360,
    paddingHorizontal: 18,
    paddingVertical: 16,
    width: '85%',
  },
  discardMessageCloseButton: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    marginRight: -2,
    width: 28,
  },
  discardMessageHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  discardMessageOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2400,
  },
  discardMessageText: {
    color: '#4b5563',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
  },
  discardMessageTitle: {
    color: '#111827',
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 0,
  },
  discardPrimaryButton: {
    alignItems: 'center',
    backgroundColor: '#0f766e',
    borderRadius: 10,
    justifyContent: 'center',
    minWidth: 88,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  discardPrimaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '500',
  },
  errorBanner: {
    backgroundColor: 'rgba(127, 29, 29, 0.96)',
    borderRadius: 14,
    left: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    position: 'absolute',
    right: 16,
  },
  errorText: {
    color: '#fee2e2',
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
  },
  formSection: {
    marginTop: 20,
  },
  helperText: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  privateAccountVisibilityNote: {
    color: '#475569',
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  privateAccountVisibilityNoteCard: {
    alignItems: 'flex-start',
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  privateAccountVisibilityNoteIconWrap: {
    alignItems: 'center',
    backgroundColor: '#ffedd5',
    borderRadius: 999,
    height: 20,
    justifyContent: 'center',
    marginRight: 8,
    marginTop: 1,
    width: 20,
  },
  header: {
    backgroundColor: '#ffffff',
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
  },
  headerDivider: {
    backgroundColor: '#f1f5f9',
    height: 1,
    marginHorizontal: 20,
    width: '100%',
  },
  headerIconButton: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  headerMeta: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: 12,
  },
  headerSubtitle: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
    textAlign: 'center',
  },
  headerSubmitButton: {
    alignItems: 'center',
    backgroundColor: '#fde7cf',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    minWidth: 92,
    paddingHorizontal: 18,
  },
  headerSubmitButtonEnabled: {
    backgroundColor: '#ffdbbb',
  },
  headerSubmitText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  headerSubmitTextEnabled: {
    color: '#f97316',
  },
  headerTitle: {
    color: '#1e293b',
    fontSize: 19,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#f1f5f9',
    borderRadius: 20,
    borderWidth: 1.5,
    color: '#1e293b',
    fontSize: 14.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionCheckFilled: {
    alignItems: 'center',
    backgroundColor: '#f97316',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  optionCheckOutline: {
    borderColor: '#cbd5e1',
    borderRadius: 12,
    borderWidth: 1.5,
    height: 24,
    width: 24,
  },
  optionDescription: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  optionIconWrap: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginRight: 12,
    width: 36,
  },
  optionIconWrapSelected: {
    backgroundColor: '#fff7ed',
  },
  optionLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    marginRight: 12,
  },
  optionList: {
    gap: 10,
    marginTop: 10,
  },
  optionRow: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#f1f5f9',
    borderRadius: 22,
    borderWidth: 1.5,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 88,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  optionRowSelected: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
  },
  optionTextWrap: {
    flexShrink: 1,
  },
  optionTitle: {
    color: '#1e293b',
    fontSize: 15,
    fontWeight: '900',
  },
  optionTitleSelected: {
    color: '#f97316',
  },
  currentTagChip: {
    backgroundColor: '#fff7ed',
    borderColor: '#fdba74',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  currentTagChipText: {
    color: '#c2410c',
    fontSize: 11.5,
    fontWeight: '700',
  },
  inlineErrorText: {
    color: '#dc2626',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
  },
  inlineTagPanel: {
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 14,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlineTagOpenButton: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  inlineTagOpenButtonText: {
    color: '#0f766e',
    fontSize: 11.5,
    fontWeight: '500',
  },
  inlineTagPanelErrorText: {
    color: '#dc2626',
    fontSize: 12,
    lineHeight: 17,
  },
  inlineTagPanelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  inlineTagPanelState: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 28,
  },
  inlineTagPanelStateText: {
    color: '#6b7280',
    fontSize: 12,
    marginLeft: 8,
  },
  inlineTagSuggestionChip: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 8,
    minWidth: 112,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inlineTagSuggestionChipMeta: {
    color: '#64748b',
    fontSize: 10.5,
    marginTop: 2,
  },
  inlineTagSuggestionChipText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '800',
  },
  inlineTagSuggestionRow: {
    flexDirection: 'row',
    paddingRight: 6,
  },
  inlineTagPanelTitle: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '500',
  },
  progressBarFill: {
    backgroundColor: '#fb923c',
    borderRadius: 999,
    height: '100%',
    minWidth: 18,
  },
  progressBarTrack: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 999,
    height: 7,
    overflow: 'hidden',
    width: '100%',
  },
  progressCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.97)',
    borderRadius: 16,
    left: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    position: 'absolute',
    right: 16,
  },
  progressHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  progressMeta: {
    color: '#fdba74',
    fontSize: 11.5,
    fontWeight: '700',
    marginLeft: 12,
  },
  progressTitle: {
    color: '#fff7ed',
    flex: 1,
    fontSize: 12.5,
    fontWeight: '600',
  },
  screen: {
    backgroundColor: '#ffffff',
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 18,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#1e293b',
    fontSize: 14.5,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  locationSection: {
    overflow: 'visible',
    position: 'relative',
    zIndex: 40,
  },
  locationSelectionMeta: {
    color: '#0f766e',
    fontSize: 11.5,
    marginTop: 8,
  },
  createLocationHeaderRowCompact: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  createLocationMetaCompact: {
    color: '#0f766e',
    fontSize: 11.5,
    marginTop: 8,
  },
  createLocationSectionCompact: {
    paddingHorizontal: 16,
    paddingTop: 10,
    zIndex: 60,
  },
  summaryCard: {
    backgroundColor: '#ffffff',
    borderColor: '#f1f5f9',
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  summaryChip: {
    alignItems: 'center',
    backgroundColor: '#fff7ed',
    borderColor: '#ffedd5',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  summaryChipText: {
    color: '#f97316',
    fontSize: 12.5,
    fontWeight: '800',
  },
  summaryIdentity: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    flex: 1,
  },
  summaryIdentityText: {
    flex: 1,
    marginLeft: 0,
  },
  summaryPreviewMedia: {
    height: '100%',
    width: '100%',
  },
  summaryPreviewWrap: {
    borderRadius: 20,
    height: 180,
    marginTop: 16,
    overflow: 'hidden',
    width: '100%',
  },
  summarySubtitle: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  summaryTitle: {
    color: '#1e293b',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  summaryTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tagChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  tagLoadingRow: {
    marginTop: 10,
    paddingVertical: 4,
  },
  tagSuggestionChip: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe3ef',
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 112,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  tagSuggestionChipMeta: {
    color: '#64748b',
    fontSize: 10.5,
    marginTop: 3,
  },
  tagSuggestionChipText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '800',
  },
  trendingTagApplyButton: {
    alignItems: 'center',
    backgroundColor: '#0f766e',
    borderRadius: 10,
    justifyContent: 'center',
    minWidth: 96,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  trendingTagApplyButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '500',
  },
  trendingTagBrowseAction: {
    alignItems: 'center',
    borderColor: '#dbe3ef',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 10,
  },
  trendingTagBrowseActionText: {
    color: '#4b5563',
    fontSize: 12,
    fontWeight: '500',
    marginRight: 6,
  },
  trendingTagDetailLoading: {
    alignItems: 'center',
    paddingVertical: 28,
  },
  trendingTagDetailLoadingText: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 8,
  },
  trendingTagDetailName: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '500',
  },
  trendingTagPostList: {
    marginTop: 14,
    paddingBottom: 12,
  },
  trendingTagDetailScroll: {
    flex: 1,
    marginTop: 12,
  },
  trendingTagDetailSubtle: {
    color: '#6b7280',
    fontSize: 11.5,
    marginTop: 3,
  },
  trendingTagDetailTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  trendingTagEmptyState: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 20,
  },
  trendingTagEmptyStateText: {
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'center',
  },
  trendingTagErrorCard: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  trendingTagErrorText: {
    color: '#e11d48',
    fontSize: 12,
  },
  trendingTagIconButton: {
    alignItems: 'center',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  trendingTagIconButtonPlaceholder: {
    height: 36,
    width: 36,
  },
  trendingTagList: {
    flex: 1,
    marginTop: 10,
  },
  trendingTagListIconWrap: {
    alignItems: 'center',
    backgroundColor: '#fff0f2',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    marginRight: 10,
    width: 36,
  },
  trendingTagListItem: {
    alignItems: 'center',
    backgroundColor: '#eef0f4',
    borderColor: '#e8ebf0',
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    minHeight: 66,
    paddingHorizontal: 12,
  },
  trendingTagListMeta: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  trendingTagListTextWrap: {
    flex: 1,
  },
  trendingTagListTitle: {
    color: '#111827',
    fontSize: 13.5,
    fontWeight: '400',
  },
  trendingTagModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.34)',
  },
  trendingTagModalHeader: {
    alignItems: 'center',
    borderBottomColor: '#e7e8ec',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 10,
  },
  trendingTagModalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  trendingTagModalSheet: {
    backgroundColor: '#f4f5f7',
    borderTopLeftRadius: 38,
    borderTopRightRadius: 38,
    maxHeight: '92%',
    paddingHorizontal: 16,
  },
  trendingTagModalTitle: {
    color: '#111827',
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    textAlign: 'center',
  },
  trendingTagPostAuthor: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '500',
  },
  trendingTagPostBody: {
    flex: 1,
    marginLeft: 10,
  },
  trendingTagPostCaption: {
    color: '#6b7280',
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 2,
  },
  trendingTagPostCard: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 8,
    padding: 8,
  },
  trendingTagPostMedia: {
    height: '100%',
    width: '100%',
  },
  trendingTagPostMediaWrap: {
    borderRadius: 10,
    height: 52,
    overflow: 'hidden',
    width: 52,
  },
  trendingTagRelatedChip: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe3ef',
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  trendingTagRelatedChipText: {
    color: '#334155',
    fontSize: 11.5,
    fontWeight: '500',
  },
  trendingTagRelatedRow: {
    marginTop: 12,
  },
  trendingTagSearchInput: {
    color: '#111827',
    flex: 1,
    fontSize: 13,
    marginLeft: 8,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  trendingTagSearchRow: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dbe3ef',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    height: 42,
    marginTop: 12,
    paddingHorizontal: 11,
  },
  trendingTagStatCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e5e7eb',
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  trendingTagStatLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '500',
  },
  trendingTagStatValue: {
    color: '#111827',
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 4,
  },
  trendingTagStatsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  trendingTagTabButton: {
    alignItems: 'center',
    borderRadius: 999,
    flex: 1,
    paddingVertical: 8,
  },
  trendingTagTabButtonActive: {
    backgroundColor: '#111827',
  },
  trendingTagTabButtonText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '500',
  },
  trendingTagTabButtonTextActive: {
    color: '#ffffff',
  },
  trendingTagTabRow: {
    backgroundColor: '#e8eaf0',
    borderRadius: 999,
    flexDirection: 'row',
    marginTop: 12,
    padding: 3,
  },
  validationBanner: {
    backgroundColor: 'rgba(30, 41, 59, 0.96)',
    borderRadius: 14,
    left: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    position: 'absolute',
    right: 16,
  },
  validationText: {
    color: '#e2e8f0',
    fontSize: 12.5,
    fontWeight: '600',
    textAlign: 'center',
  },
});

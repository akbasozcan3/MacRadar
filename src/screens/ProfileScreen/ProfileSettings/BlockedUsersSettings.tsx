import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FeatherIcon from '../../../components/FeatherIcon/FeatherIcon';
import IosTitleHeader from '../../../components/Headers/IosTitleHeader';
import IosSpinner from '../../../components/IosSpinner/IosSpinner';
import { isApiRequestError } from '../../../services/apiClient';
import { blockUser, fetchBlockedUsers, unblockUser } from '../../../services/authService';
import { searchExploreUsers } from '../../../services/exploreService';
import { Text, TextInput } from '../../../theme/typography';
import type { BlockedUserItem } from '../../../types/AuthTypes/AuthTypes';
import type { ExploreSearchUser } from '../../../types/ExploreTypes/ExploreTypes';

type BlockedUsersSettingsProps = {
  contentBottomInset?: number;
  onBack?: () => void;
  safeBottom?: number;
  safeTop?: number;
};

const SEARCH_DEBOUNCE_MS = 260;
const SEARCH_LIMIT = 8;

export default function BlockedUsersSettings({
  contentBottomInset = 0,
  onBack,
  safeBottom = 0,
  safeTop = 0,
}: BlockedUsersSettingsProps) {
  const [items, setItems] = useState<BlockedUserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ExploreSearchUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRequestIdRef = useRef(0);
  const blockedListRequestIdRef = useRef(0);
  const footerInset = Math.max(contentBottomInset, safeBottom + 90);
  const enterAnimation = useRef(new Animated.Value(0)).current;
  const scrollContentStyle = useMemo(
    () => ({ paddingBottom: footerInset }),
    [footerInset],
  );

  useEffect(() => {
    enterAnimation.setValue(0);
    Animated.spring(enterAnimation, {
      damping: 20,
      mass: 0.8,
      stiffness: 220,
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [enterAnimation]);

  const animatedStyle = useMemo(
    () => ({
      opacity: enterAnimation,
      transform: [
        {
          translateY: enterAnimation.interpolate({
            inputRange: [0, 1],
            outputRange: [10, 0],
          }),
        },
      ],
    }),
    [enterAnimation],
  );

  const loadBlockedUsers = useCallback(async (mode: 'initial' | 'refresh') => {
    blockedListRequestIdRef.current += 1;
    const requestId = blockedListRequestIdRef.current;

    if (mode === 'initial') {
      setIsLoading(true);
    }
    setErrorMessage(null);

    try {
      const response = await fetchBlockedUsers();
      if (blockedListRequestIdRef.current !== requestId) {
        return;
      }
      setItems(response.users);
    } catch (error) {
      if (blockedListRequestIdRef.current !== requestId) {
        return;
      }
      setErrorMessage(
        isApiRequestError(error)
          ? error.message
          : 'Engellenen kullanicilar yuklenemedi.',
      );
    } finally {
      if (blockedListRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadBlockedUsers('initial').catch(() => {
      return;
    });
  }, [loadBlockedUsers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  useEffect(() => {
    if (searchQuery.length === 0) {
      searchRequestIdRef.current += 1;
      setSearchResults([]);
      setIsSearching(false);
      setSearchError(null);
      return;
    }

    searchRequestIdRef.current += 1;
    const requestId = searchRequestIdRef.current;
    setIsSearching(true);
    setSearchError(null);
    setSearchResults([]);

    searchExploreUsers(searchQuery, SEARCH_LIMIT)
      .then(response => {
        if (searchRequestIdRef.current !== requestId) {
          return;
        }

        const blockedIds = new Set(items.map(item => item.id));
        const filtered = response.users.filter(user => !blockedIds.has(user.id));
        setSearchResults(filtered);
      })
      .catch(error => {
        if (searchRequestIdRef.current !== requestId) {
          return;
        }
        setSearchResults([]);
        setSearchError(
          isApiRequestError(error)
            ? error.message
            : 'Kullanici aramasi su an calismiyor.',
        );
      })
      .finally(() => {
        if (searchRequestIdRef.current === requestId) {
          setIsSearching(false);
        }
      });
  }, [items, searchQuery]);

  async function handleUnblock(userId: string) {
    if (pendingUserId || userId.trim().length === 0) {
      return;
    }

    const previousItems = items;
    setPendingUserId(userId);
    setErrorMessage(null);
    setItems(previous => previous.filter(item => item.id !== userId));

    try {
      await unblockUser(userId);
    } catch (error) {
      setItems(previousItems);
      setErrorMessage(
        isApiRequestError(error) ? error.message : 'Engel kaldirilamadi.',
      );
    } finally {
      setPendingUserId(null);
    }
  }

  async function handleBlock(user: ExploreSearchUser) {
    if (pendingUserId || user.id.trim().length === 0) {
      return;
    }

    const previousItems = items;
    const previousSearchResults = searchResults;
    const optimisticItem: BlockedUserItem = {
      avatarUrl: user.avatarUrl,
      blockedAt: new Date().toISOString(),
      fullName: user.fullName,
      id: user.id,
      isVerified: user.isVerified,
      username: user.username,
    };

    setPendingUserId(user.id);
    setErrorMessage(null);
    setSearchError(null);
    setItems(previous => {
      const withoutDuplicate = previous.filter(item => item.id !== user.id);
      return [optimisticItem, ...withoutDuplicate];
    });
    setSearchResults(previous => previous.filter(item => item.id !== user.id));

    try {
      await blockUser(user.id);
      loadBlockedUsers('refresh').catch(() => {
        return;
      });
    } catch (error) {
      setItems(previousItems);
      setSearchResults(previousSearchResults);
      setErrorMessage(
        isApiRequestError(error) ? error.message : 'Kullanici engellenemedi.',
      );
    } finally {
      setPendingUserId(null);
    }
  }

  function formatInitials(name: string, username: string) {
    const source = name.trim() || username.trim();
    return source.slice(0, 2).toUpperCase();
  }

  return (
    <SafeAreaView edges={['left', 'right']} className="flex-1 bg-[#f2f2f7]">
      <IosTitleHeader
        onBack={onBack}
        safeTop={safeTop}
        title="Engellenen Kullanicilar"
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={scrollContentStyle}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View className="px-4 pt-[10px]" style={animatedStyle}>
          <View className="mb-3 flex-row items-start rounded-[12px] border border-[#e3e8f1] bg-[#ecf2fa] px-3 py-3">
            <View className="mr-2 mt-[1px] h-4 w-4 items-center justify-center rounded-full bg-[#ffefe6]">
              <FeatherIcon color="#ff6a1b" name="info" size={10} />
            </View>
            <Text className="flex-1 text-[11px] leading-[16px] text-[#5f6b7b]">
              Engelledigin hesaplar seni goremez, takip edemez ve aramada
              listelenmez.
            </Text>
          </View>

          <View className="mb-3 rounded-[16px] border border-[#e6e9f0] bg-white px-3 py-3">
            <Text className="text-[13px] text-[#1f2530]">Kullanici Engelle</Text>
            <View className="mt-2 flex-row items-center rounded-[12px] border border-[#dde3ee] bg-[#f8f9fc] px-3 py-2.5">
              <FeatherIcon color="#7b8493" name="search" size={14} />
              <TextInput
                allowFontScaling={false}
                autoCapitalize="none"
                autoCorrect={false}
                className="ml-2 flex-1 py-0 text-[12px] text-[#1f2530]"
                onChangeText={setSearchInput}
                placeholder="Kullanici ara (@username)"
                placeholderTextColor="#9ca3b0"
                returnKeyType="search"
                value={searchInput}
              />
            </View>

            {searchError ? (
              <Text className="mt-2 text-[11px] text-rose-600">{searchError}</Text>
            ) : null}

            {searchQuery.length === 0 ? (
              <Text className="mt-2 text-[11px] text-[#788295]">
                Engellemek istedigin hesabi bulmak icin ad veya kullanici adi yaz.
              </Text>
            ) : isSearching ? (
              <View className="mt-2 flex-row items-center">
                <IosSpinner size="small" />
                <Text className="ml-2 text-[11px] text-[#788295]">
                  Kullanicilar araniyor...
                </Text>
              </View>
            ) : searchResults.length === 0 ? (
              <Text className="mt-2 text-[11px] text-[#788295]">
                Engellenebilecek kullanici bulunamadi.
              </Text>
            ) : (
              <View className="mt-2">
                {searchResults.map((user, index) => {
                  const isPending = pendingUserId === user.id;
                  return (
                    <View key={user.id}>
                      <View className="flex-row items-center py-2">
                        <View className="h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-[#d9dee7]">
                          {user.avatarUrl ? (
                            <Image
                              className="h-full w-full"
                              resizeMode="cover"
                              source={{ uri: user.avatarUrl }}
                            />
                          ) : (
                            <Text className="text-[11px] text-[#4e5768]">
                              {formatInitials(user.fullName, user.username)}
                            </Text>
                          )}
                        </View>
                        <View className="ml-3 flex-1">
                          <Text className="text-[12px] text-[#1f2530]">
                            {user.fullName.trim() || user.username}
                          </Text>
                          <Text className="text-[11px] text-[#7f8694]">
                            @{user.username}
                          </Text>
                        </View>
                        <Pressable
                          className={`rounded-full px-3 py-1.5 ${
                            isPending ? 'bg-[#ef4444]/70' : 'bg-[#ef4444]'
                          }`}
                          disabled={isPending}
                          onPress={() => {
                            handleBlock(user).catch(() => {
                              return;
                            });
                          }}
                        >
                          <Text className="text-[10px] text-white">
                            {isPending ? '...' : 'Engelle'}
                          </Text>
                        </Pressable>
                      </View>
                      {index < searchResults.length - 1 ? (
                        <View className="h-px bg-[#edf0f5]" />
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {errorMessage ? (
            <View className="mb-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
              <Text className="text-[12px] text-rose-600">{errorMessage}</Text>
            </View>
          ) : null}

          <View className="overflow-hidden rounded-[16px] border border-[#e6e9f0] bg-white">
            {isLoading ? (
              <View className="flex-row items-center justify-center py-4">
                <IosSpinner size="small" />
                <Text className="ml-2 text-[12px] text-[#6f7685]">
                  Liste yukleniyor...
                </Text>
              </View>
            ) : items.length === 0 ? (
              <View className="items-center px-5 py-8">
                <View className="h-[56px] w-[56px] items-center justify-center rounded-full bg-[#e8eaef]">
                  <FeatherIcon color="#9aa0ad" name="shield" size={26} />
                </View>
                <Text className="mt-3 text-[13px] text-[#2a2a32]">
                  Engellenen kullanici yok
                </Text>
                <Text className="mt-1 text-center text-[10px] leading-[14px] text-[#9ca0aa]">
                  Engelledigin kullanicilar burada listelenir.
                </Text>
              </View>
            ) : (
              items.map((item, index) => {
                const isPending = pendingUserId === item.id;
                return (
                  <View key={item.id}>
                    <View className="flex-row items-center px-4 py-3">
                      <View className="h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#d9dee7]">
                        {item.avatarUrl ? (
                          <Image
                            className="h-full w-full"
                            resizeMode="cover"
                            source={{ uri: item.avatarUrl }}
                          />
                        ) : (
                          <Text className="text-[11px] text-[#4e5768]">
                            {formatInitials(item.fullName, item.username)}
                          </Text>
                        )}
                      </View>

                      <View className="ml-3 flex-1">
                        <Text className="text-[13px] text-[#1f2530]">
                          {item.fullName.trim() || item.username}
                        </Text>
                        <Text className="text-[11px] text-[#7f8694]">
                          @{item.username}
                        </Text>
                      </View>

                      <Pressable
                        className={`rounded-full border px-3 py-1.5 ${
                          isPending
                            ? 'border-[#d2d7e1] bg-[#eef1f6]'
                            : 'border-[#d2d7e1] bg-[#f6f7fa]'
                        }`}
                        disabled={isPending}
                        onPress={() => {
                          handleUnblock(item.id).catch(() => {
                            return;
                          });
                        }}
                      >
                        <Text className="text-[10px] text-[#5e6778]">
                          {isPending ? '...' : 'Engeli Kaldir'}
                        </Text>
                      </Pressable>
                    </View>
                    {index < items.length - 1 ? (
                      <View className="h-px bg-[#edf0f5]" />
                    ) : null}
                  </View>
                );
              })
            )}
          </View>

          <Pressable
            className="mt-3 flex-row items-center rounded-[12px] border border-[#e6e9f0] bg-white px-3 py-3"
            disabled={isLoading}
            onPress={() => {
              loadBlockedUsers('refresh').catch(() => {
                return;
              });
            }}
            style={({ pressed }) =>
              pressed ? { backgroundColor: '#f8fafd' } : null
            }
          >
            <View className="h-7 w-7 items-center justify-center rounded-full bg-[#f3f6fb]">
              <FeatherIcon color="#546074" name="refresh-cw" size={14} />
            </View>
            <Text className="ml-3 text-[13px] text-[#2a3342]">
              Engellenen Listesini Yenile
            </Text>
          </Pressable>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

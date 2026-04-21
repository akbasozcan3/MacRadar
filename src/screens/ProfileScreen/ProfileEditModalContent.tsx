import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import FeatherIcon from '../../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../../components/IosSpinner/IosSpinner';
import {
  fetchCountryCallingCodes,
  type CountryCallingCodeRow,
} from '../../services/authService';
import { Text } from '../../theme/typography';
import type { ProfileGender } from '../../types/AuthTypes/AuthTypes';
import { translateText } from '../../i18n/runtime';

const SCREEN_BG = '#ECEEF2';
const INPUT_BG = '#E8EAEE';
const ORANGE = '#FF632E';
const ORANGE_SOFT_BG = 'rgba(255, 99, 46, 0.14)';
const TEXT_PRIMARY = '#111827';
const PLACEHOLDER_COLOR = '#9CA3AF';
const CARD_RADIUS = 26;
const PILL_RADIUS = 999;
const BIO_RADIUS = 18;
const AVATAR_SIZE = 90;
const TOP_BTN = 42;
const TAB_ICON_INACTIVE = '#6B7280';

const GENDER_OPTIONS: ProfileGender[] = [
  'male',
  'female',
  'non_binary',
  'prefer_not_to_say',
];

function genderLabel(g: ProfileGender): string {
  switch (g) {
    case 'male':
      return translateText('Erkek');
    case 'female':
      return translateText('Kadın');
    case 'non_binary':
      return translateText('İkili Olmayan');
    default:
      return translateText('Belirtmek İstemiyorum');
  }
}

function parseBirthDateString(value: string): Date | null {
  const t = value.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) {
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d, 12, 0, 0, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

function formatDateOnly(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export type ProfileEditModalContentProps = {
  animatePressScale: (anim: Animated.Value, to: number) => void;
  bioMaxLength: number;
  contentBottomInset: number;
  editAvatarScale: Animated.Value;
  editAvatarUrl: string;
  editBio: string;
  editBirthDate: string;
  editConfirmScale: Animated.Value;
  editError: string | null;
  editFirstName: string;
  editGender: ProfileGender;
  editLastName: string;
  editUsername: string;
  editPhoneDialCode: string;
  editPhoneDigits: string;
  isUsernameChecking?: boolean;
  /** When false, save control looks inactive (no changes) and does not submit. */
  isSaveEnabled?: boolean;
  isSavingEdit: boolean;
  onChangePhoto: () => void;
  onClose: () => void;
  onOpenAccountInfo?: () => void;
  onSave: () => void;
  setEditBio: (v: string) => void;
  setEditBirthDate: (v: string) => void;
  setEditFirstName: (v: string) => void;
  setEditGender: (g: ProfileGender) => void;
  setEditLastName: (v: string) => void;
  setEditUsername: (v: string) => void;
  setEditPhoneDialCode: (v: string) => void;
  setEditPhoneDigits: (v: string) => void;
  canEditUsername?: boolean;
  usernameStatusMessage?: string | null;
  usernameStatusTone?: 'muted' | 'success' | 'error';
  /** Fallback when insets are zero (e.g. edge Provider quirks). */
  safeBottom: number;
  safeTop: number;
};

export default function ProfileEditModalContent({
  animatePressScale,
  bioMaxLength,
  contentBottomInset,
  editAvatarScale,
  editAvatarUrl,
  editBio,
  editBirthDate,
  editConfirmScale,
  editError,
  editFirstName,
  editGender,
  editLastName,
  editUsername,
  editPhoneDialCode,
  editPhoneDigits,
  isUsernameChecking = false,
  isSaveEnabled = true,
  isSavingEdit,
  onChangePhoto,
  onClose,
  onOpenAccountInfo,
  onSave,
  setEditBio,
  setEditBirthDate,
  setEditFirstName,
  setEditGender,
  setEditLastName,
  setEditUsername,
  setEditPhoneDialCode,
  setEditPhoneDigits,
  safeBottom,
  safeTop,
  canEditUsername = false,
  usernameStatusMessage = null,
  usernameStatusTone = 'muted',
}: ProfileEditModalContentProps) {
  const insets = useSafeAreaInsets();
  const statusBarH =
    Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
  const padTop = Math.max(insets.top, safeTop, statusBarH) + 4;
  const padBottom = Math.max(insets.bottom, safeBottom);

  const [genderSheetVisible, setGenderSheetVisible] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [countryRows, setCountryRows] = useState<CountryCallingCodeRow[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerDate, setPickerDate] = useState(() => {
    const parsed = parseBirthDateString(editBirthDate);
    return parsed ?? new Date(2000, 0, 1, 12, 0, 0, 0);
  });

  useEffect(() => {
    const parsed = parseBirthDateString(editBirthDate);
    if (parsed) {
      setPickerDate(parsed);
    }
  }, [editBirthDate]);

  const birthDisplay = useMemo(() => {
    const p = parseBirthDateString(editBirthDate);
    return p ? formatDateOnly(p) : '';
  }, [editBirthDate]);

  const onDateChange = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      if (Platform.OS === 'android') {
        setShowDatePicker(false);
      }
      if (event.type === 'dismissed' || !date) {
        return;
      }
      setPickerDate(date);
      setEditBirthDate(formatDateOnly(date));
    },
    [setEditBirthDate],
  );

  const clearBirthDate = useCallback(() => {
    setEditBirthDate('');
  }, [setEditBirthDate]);

  const dialDigits = useMemo(
    () => editPhoneDialCode.replace(/\D/g, '').slice(0, 4) || '90',
    [editPhoneDialCode],
  );
  const maxPhoneNational = useMemo(
    () => Math.min(14, Math.max(4, 15 - dialDigits.length)),
    [dialDigits],
  );
  const selectedDialMeta = useMemo(() => {
    const hit = countryRows.find(c => c.dial === dialDigits);
    return hit ?? { dial: dialDigits, flag: '', iso2: '', name: '' };
  }, [countryRows, dialDigits]);

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (q.length === 0) {
      return countryRows;
    }
    return countryRows.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        c.dial.includes(q) ||
        c.iso2.toLowerCase().includes(q),
    );
  }, [countryRows, countrySearch]);

  useEffect(() => {
    let cancelled = false;
    setCountriesLoading(true);
    fetchCountryCallingCodes()
      .then(rows => {
        if (!cancelled) {
          setCountryRows(rows);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCountryRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setCountriesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyDialCode = useCallback(
    (dial: string) => {
      const d = dial.replace(/\D/g, '').slice(0, 4);
      if (d.length < 1) {
        return;
      }
      setEditPhoneDialCode(d);
      const maxNat = Math.min(14, Math.max(4, 15 - d.length));
      setEditPhoneDigits(
        editPhoneDigits.replace(/\D/g, '').slice(0, maxNat),
      );
      setCountryPickerOpen(false);
      setCountrySearch('');
    },
    [editPhoneDigits, setEditPhoneDialCode, setEditPhoneDigits],
  );

  const footerPad = Math.max(16, contentBottomInset, 10);

  return (
    <SafeAreaView
      edges={['left', 'right']}
      className="flex-1 bg-slate-100"
      style={[styles.screen, { paddingTop: padTop, paddingBottom: padBottom }]}
    >
      <StatusBar
        backgroundColor="transparent"
        barStyle="dark-content"
        translucent
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: footerPad,
              paddingHorizontal: 16,
              paddingTop: 6,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            className="mx-auto w-full max-w-[440px] rounded-[28px] border border-slate-200 bg-white px-5 pb-8 pt-4"
            style={styles.mainCard}
          >
            <View className="mb-4 flex-row items-center justify-between" style={styles.cardHeaderRow}>
              <View style={styles.headerSide}>
                <Pressable
                  disabled={isSavingEdit}
                  onPress={onClose}
                  className="h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-white"
                  style={({ pressed }) => [
                    styles.topCircleLight,
                    pressed ? styles.pressedOpacity : null,
                  ]}
                >
                  <FeatherIcon color={TEXT_PRIMARY} name="arrow-left" size={22} />
                </Pressable>
              </View>
              <View style={styles.headerTitleWrap}>
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={styles.headerTitle}
                >
                  {translateText('Profili Düzenle')}
                </Text>
              </View>
              <View style={[styles.headerSide, styles.headerSideEnd]}>
                <Animated.View style={{ transform: [{ scale: editConfirmScale }] }}>
                  <Pressable
                    disabled={isSavingEdit || !isSaveEnabled}
                    hitSlop={10}
                    onPress={() => {
                      onSave();
                    }}
                    onPressIn={() => {
                      if (!isSavingEdit && isSaveEnabled) {
                        animatePressScale(editConfirmScale, 0.92);
                      }
                    }}
                    onPressOut={() => {
                      animatePressScale(editConfirmScale, 1);
                    }}
                    className="h-12 w-12 items-center justify-center rounded-full"
                    style={({ pressed }) => [
                      isSavingEdit || isSaveEnabled
                        ? styles.topCircleOrange
                        : styles.topSaveMuted,
                      isSavingEdit ? styles.saveDisabled : null,
                      pressed && (isSaveEnabled || isSavingEdit)
                        ? styles.pressedOpacity
                        : null,
                    ]}
                  >
                    {isSavingEdit ? (
                      <IosSpinner color="#ffffff" size="small" />
                    ) : (
                      <FeatherIcon
                        color={isSaveEnabled ? '#FFFFFF' : '#9CA3AF'}
                        name="check"
                        size={22}
                      />
                    )}
                  </Pressable>
                </Animated.View>
              </View>
            </View>

            <View className="mb-3 items-center" style={styles.avatarBlock}>
              <Animated.View style={{ transform: [{ scale: editAvatarScale }] }}>
                <Pressable
                  onPress={onChangePhoto}
                  onPressIn={() => animatePressScale(editAvatarScale, 0.96)}
                  onPressOut={() => animatePressScale(editAvatarScale, 1)}
                  className="rounded-full border-2 border-white"
                  style={styles.avatarRing}
                >
                  {editAvatarUrl.trim().length > 0 ? (
                    <Image
                      source={{ uri: editAvatarUrl.trim() }}
                      style={styles.avatarImg}
                    />
                  ) : (
                    <View style={[styles.avatarImg, styles.avatarPlaceholder]}>
                      <FeatherIcon
                        color={TAB_ICON_INACTIVE}
                        name="user"
                        size={34}
                      />
                    </View>
                  )}
                </Pressable>
              </Animated.View>

              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={onChangePhoto}
                className="mt-3 rounded-full border border-orange-200 bg-orange-50 px-5 py-2.5"
                style={({ pressed }) => [
                  styles.changePhotoPill,
                  pressed ? styles.pressedOpacity : null,
                ]}
              >
                <Text allowFontScaling={false} style={styles.changePhotoPillText}>
                  {translateText('Profil Resmini Değiştir')}
                </Text>
              </Pressable>
            </View>

            {editError ? (
              <View style={styles.errorBannerInCard}>
                <FeatherIcon color="#B91C1C" name="alert-triangle" size={16} />
                <Text allowFontScaling={false} style={styles.errorBannerText}>
                  {editError}
                </Text>
              </View>
            ) : null}

            {onOpenAccountInfo ? (
              <Pressable
                accessibilityRole="button"
                disabled={isSavingEdit}
                onPress={onOpenAccountInfo}
                className="mb-5 flex-row items-center rounded-2xl border border-slate-200 bg-slate-50 px-3.5 py-3.5"
                style={({ pressed }) => [
                  styles.accountInfoRow,
                  pressed ? styles.pressedOpacity : null,
                ]}
              >
                <View style={styles.accountInfoLeft}>
                  <View style={styles.accountInfoIconWrap}>
                    <FeatherIcon color={ORANGE} name="key" size={18} />
                  </View>
                  <View style={styles.accountInfoTextCol}>
                    <Text allowFontScaling={false} style={styles.accountInfoTitle}>
                      {translateText('Hesap bilgileri')}
                    </Text>
                    <Text
                      allowFontScaling={false}
                      style={styles.accountInfoSubtitle}
                    >
                      {translateText('E-posta, şifre ve güvenlik')}
                    </Text>
                  </View>
                </View>
                <FeatherIcon color={PLACEHOLDER_COLOR} name="chevron-right" size={20} />
              </Pressable>
            ) : null}

            <View style={styles.formSection}>
              <Text allowFontScaling={false} style={styles.sectionTitle}>
                {translateText('Profil Bilgileri')}
              </Text>
              <View style={styles.sectionRule} />
            </View>

            <View style={styles.fieldBlock}>
              <Text allowFontScaling={false} style={styles.fieldMicroLabel}>
                {translateText('Ad')}
              </Text>
              <TextInput
                autoCapitalize="words"
                onChangeText={setEditFirstName}
                placeholder={translateText('Ad')}
                placeholderTextColor={PLACEHOLDER_COLOR}
                className="rounded-full border border-slate-200 bg-slate-100 px-4 py-3.5 text-[16px] text-slate-900"
                style={styles.stadiumInput}
                value={editFirstName}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text allowFontScaling={false} style={styles.fieldMicroLabel}>
                {translateText('Soyad')}
              </Text>
              <TextInput
                autoCapitalize="words"
                onChangeText={setEditLastName}
                placeholder={translateText('Soyad')}
                placeholderTextColor={PLACEHOLDER_COLOR}
                className="rounded-full border border-slate-200 bg-slate-100 px-4 py-3.5 text-[16px] text-slate-900"
                style={styles.stadiumInput}
                value={editLastName}
              />
            </View>

            <View style={styles.fieldBlock}>
              <Text allowFontScaling={false} style={styles.fieldMicroLabel}>
                {translateText('Kullanıcı adı')}
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                editable={canEditUsername}
                onChangeText={text =>
                  setEditUsername(text.replace(/[^A-Za-z0-9]/g, '').toLowerCase())
                }
                placeholder={translateText('Kullanıcı adı')}
                placeholderTextColor={PLACEHOLDER_COLOR}
                className="rounded-full border border-slate-200 bg-slate-100 px-4 py-3.5 text-[16px] text-slate-900"
                style={[styles.stadiumInput, !canEditUsername ? styles.readonlyInput : null]}
                value={editUsername}
              />
              {canEditUsername && usernameStatusMessage ? (
                <View style={styles.usernameStatusRow}>
                  {isUsernameChecking ? (
                    <ActivityIndicator color="#64748B" size="small" />
                  ) : usernameStatusTone === 'success' ? (
                    <FeatherIcon color="#16A34A" name="check-circle" size={13} />
                  ) : usernameStatusTone === 'error' ? (
                    <FeatherIcon color="#B42318" name="alert-circle" size={13} />
                  ) : null}
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.usernameStatusText,
                      usernameStatusTone === 'success'
                        ? styles.usernameStatusSuccess
                        : null,
                      usernameStatusTone === 'error'
                        ? styles.usernameStatusError
                        : null,
                    ]}
                  >
                    {usernameStatusMessage}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.fieldBlock}>
              <Text allowFontScaling={false} style={styles.fieldMicroLabel}>
                {translateText('Cinsiyet')}
              </Text>
              <Pressable
                accessibilityLabel={translateText('Cinsiyet')}
                onPress={() => setGenderSheetVisible(true)}
                className="rounded-full border border-slate-200 bg-slate-100 px-4"
                style={({ pressed }) => [
                  styles.stadiumInput,
                  styles.rowBetween,
                  pressed ? styles.pressedOpacity : null,
                ]}
              >
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={styles.inputLikeText}
                >
                  {genderLabel(editGender)}
                </Text>
                <FeatherIcon
                  color={PLACEHOLDER_COLOR}
                  name="chevron-down"
                  size={20}
                />
              </Pressable>
            </View>

            <View style={styles.fieldBlock}>
              <Text allowFontScaling={false} style={styles.fieldMicroLabel}>
                {translateText('Doğum Tarihi')}
              </Text>
              <View style={styles.birthRowShell}>
                <Pressable
                  onPress={() => {
                    const base =
                      parseBirthDateString(editBirthDate) ??
                      new Date(2000, 0, 1, 12, 0, 0, 0);
                    setPickerDate(base);
                    setShowDatePicker(true);
                  }}
                  className="flex-1 justify-center"
                  style={({ pressed }) => [
                    styles.birthPressable,
                    pressed ? styles.pressedOpacity : null,
                  ]}
                >
                  <Text
                    allowFontScaling={false}
                    style={
                      birthDisplay
                        ? styles.inputLikeText
                        : styles.placeholderLike
                    }
                  >
                    {birthDisplay || translateText('Doğum Tarihi')}
                  </Text>
                </Pressable>
                {birthDisplay.length > 0 ? (
                  <Pressable
                    accessibilityLabel={translateText('Temizle')}
                    hitSlop={10}
                    onPress={clearBirthDate}
                    style={({ pressed }) => [
                      styles.clearBirthInner,
                      pressed ? styles.pressedOpacity : null,
                    ]}
                  >
                    <FeatherIcon color={PLACEHOLDER_COLOR} name="x" size={20} />
                  </Pressable>
                ) : (
                  <View style={styles.clearBirthSpacer} />
                )}
              </View>
            </View>

            <View style={styles.fieldBlock}>
              <Text allowFontScaling={false} style={styles.fieldMicroLabel}>
                {translateText('Cep telefonu')}
              </Text>
              <View style={styles.phoneRow}>
                <Pressable
                  accessibilityLabel={translateText('Ülke kodu')}
                  disabled={isSavingEdit}
                  onPress={() => setCountryPickerOpen(true)}
                  className="h-[54px] min-w-[100px] flex-row items-center justify-center rounded-full border border-slate-200 bg-slate-100 px-3"
                  style={({ pressed }) => [
                    styles.phonePrefix,
                    pressed ? styles.pressedOpacity : null,
                  ]}
                >
                  <Text allowFontScaling={false} style={styles.flagEmoji}>
                    {selectedDialMeta.flag.trim().length > 0
                      ? selectedDialMeta.flag
                      : '🌍'}
                  </Text>
                  <Text allowFontScaling={false} style={styles.phonePrefixText}>
                    +{dialDigits}
                  </Text>
                  <FeatherIcon
                    color={PLACEHOLDER_COLOR}
                    name="chevron-down"
                    size={18}
                  />
                </Pressable>
                <TextInput
                  keyboardType="phone-pad"
                  maxLength={maxPhoneNational}
                  onChangeText={text =>
                    setEditPhoneDigits(
                      text.replace(/[^0-9]/g, '').slice(0, maxPhoneNational),
                    )
                  }
                  placeholder={
                    dialDigits === '90'
                      ? translateText('5XX XXX XX XX')
                      : translateText('Telefon numarasi')
                  }
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  className="flex-1 rounded-full border border-slate-200 bg-slate-100 px-4 py-3.5 text-[16px] text-slate-900"
                  style={[styles.stadiumInput, styles.phoneInputFlex]}
                  value={editPhoneDigits}
                />
              </View>
            </View>

            <View style={[styles.fieldBlock, styles.fieldBlockLast]}>
              <Text allowFontScaling={false} style={styles.fieldMicroLabel}>
                {translateText('Bio')}
              </Text>
              <View style={styles.bioWrap}>
                <TextInput
                  maxLength={bioMaxLength}
                  multiline
                numberOfLines={3}
                  onChangeText={setEditBio}
                  placeholder={translateText('Hakkınızda kısa bir not...')}
                  placeholderTextColor={PLACEHOLDER_COLOR}
                  className="min-h-[82px] px-3.5 pt-2.5 text-[14.5px] leading-5 text-slate-900"
                  style={styles.bioInput}
                  textAlignVertical="top"
                  value={editBio}
                />
                <Text allowFontScaling={false} style={styles.bioCounter}>
                  {editBio.length}/{bioMaxLength}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {showDatePicker && Platform.OS === 'android' ? (
        <DateTimePicker
          display="default"
          maximumDate={new Date()}
          minimumDate={new Date(1930, 0, 1)}
          mode="date"
          onChange={onDateChange}
          value={pickerDate}
        />
      ) : null}

      {showDatePicker && Platform.OS === 'ios' ? (
        <Modal
          animationType="slide"
          transparent
          visible
          onRequestClose={() => setShowDatePicker(false)}
        >
          <View style={styles.dateIosBackdrop}>
            <Pressable
              onPress={() => setShowDatePicker(false)}
              style={styles.dateIosBackdropTap}
            />
            <View
              style={[
                styles.dateIosSheet,
                { paddingBottom: Math.max(insets.bottom, 12) + 8 },
              ]}
            >
              <View style={styles.iosPickerBar}>
                <View style={{ width: 48 }} />
                <Text style={styles.dateIosTitle}>
                  {translateText('Doğum tarihi')}
                </Text>
                <Pressable
                  hitSlop={12}
                  onPress={() => setShowDatePicker(false)}
                  style={{ paddingHorizontal: 8, paddingVertical: 4 }}
                >
                  <Text style={styles.iosPickerDone}>Tamam</Text>
                </Pressable>
              </View>
              <DateTimePicker
                display="spinner"
                maximumDate={new Date()}
                minimumDate={new Date(1930, 0, 1)}
                mode="date"
                onChange={onDateChange}
                style={styles.dateIosWheel}
                textColor="#111827"
                value={pickerDate}
              />
            </View>
          </View>
        </Modal>
      ) : null}

      <Modal
        animationType="fade"
        transparent
        visible={genderSheetVisible}
        onRequestClose={() => setGenderSheetVisible(false)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            onPress={() => setGenderSheetVisible(false)}
            style={styles.sheetBackdropFill}
          />
          <View
            style={[
              styles.sheetCard,
              { paddingBottom: Math.max(insets.bottom, 16) + 12 },
            ]}
          >
            <View style={styles.sheetGrabber} />
            <Text allowFontScaling={false} style={styles.sheetTitle}>
              {translateText('Cinsiyet')}
            </Text>
            {GENDER_OPTIONS.map(opt => (
              <Pressable
                key={opt}
                onPress={() => {
                  setEditGender(opt);
                  setGenderSheetVisible(false);
                }}
                style={({ pressed }) => [
                  styles.sheetRow,
                  editGender === opt ? styles.sheetRowActive : null,
                  pressed ? styles.pressedOpacity : null,
                ]}
              >
                <View style={styles.sheetRowLeft}>
                  <View
                    style={[
                      styles.sheetRowIndicator,
                      editGender === opt ? styles.sheetRowIndicatorActive : null,
                    ]}
                  >
                    {editGender === opt ? (
                      <View style={styles.sheetRowIndicatorDot} />
                    ) : null}
                  </View>
                  <Text
                    allowFontScaling={false}
                    style={styles.sheetRowLabel}
                  >
                    {genderLabel(opt)}
                  </Text>
                </View>
                <View style={styles.sheetRowCheckSlot}>
                  {editGender === opt ? (
                    <FeatherIcon color={ORANGE} name="check" size={18} />
                  ) : null}
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent
        visible={countryPickerOpen}
        onRequestClose={() => setCountryPickerOpen(false)}
      >
        <View style={styles.countryModalRoot}>
          <Pressable
            onPress={() => setCountryPickerOpen(false)}
            style={styles.countryModalBackdrop}
          />
          <View
            style={[
              styles.countryModalSheet,
              { paddingBottom: Math.max(insets.bottom, 16) + 8 },
            ]}
          >
            <View style={styles.countryModalHeader}>
              <Text allowFontScaling={false} style={styles.countryModalTitle}>
                  {translateText('Ülke kodu')}
              </Text>
              <Pressable
                hitSlop={12}
                onPress={() => setCountryPickerOpen(false)}
                style={styles.countryModalClose}
              >
                <Text style={styles.iosPickerDone}>{translateText('Kapat')}</Text>
              </Pressable>
            </View>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setCountrySearch}
              placeholder={translateText('Ülke veya kod ara')}
              placeholderTextColor={PLACEHOLDER_COLOR}
              style={styles.countrySearchInput}
              value={countrySearch}
            />
            {countriesLoading ? (
              <View style={styles.countryLoading}>
                <ActivityIndicator color={ORANGE} size="small" />
              </View>
            ) : (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={styles.countryList}
              >
                {filteredCountries.map(c => (
                  <Pressable
                    key={`${c.iso2}-${c.dial}`}
                    onPress={() => applyDialCode(c.dial)}
                    style={({ pressed }) => [
                      styles.countryRow,
                      c.dial === dialDigits ? styles.countryRowActive : null,
                      pressed ? styles.pressedOpacity : null,
                    ]}
                  >
                    <Text allowFontScaling={false} style={styles.countryRowFlag}>
                      {c.flag || '🌍'}
                    </Text>
                    <View style={styles.countryRowMid}>
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        style={styles.countryRowName}
                      >
                        {c.name}
                      </Text>
                      <Text
                        allowFontScaling={false}
                        style={styles.countryRowIso}
                      >
                        {c.iso2}
                      </Text>
                    </View>
                    <Text allowFontScaling={false} style={styles.countryRowDial}>
                      +{c.dial}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cardHeaderRow: {
    alignItems: 'center',
    borderBottomColor: '#E2E8F0',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    minHeight: TOP_BTN,
    paddingBottom: 10,
  },
  fieldMicroLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginBottom: 5,
  },
  formSection: {
    marginBottom: 4,
    marginTop: 2,
  },
  headerSide: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    minWidth: TOP_BTN + 4,
    width: TOP_BTN + 4,
  },
  headerSideEnd: {
    alignItems: 'flex-end',
  },
  headerTitle: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  mainCard: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#DFE6EE',
    borderRadius: 26,
    borderWidth: 1,
    elevation: 9,
    maxWidth: 430,
    overflow: 'visible',
    paddingBottom: 14,
    paddingHorizontal: 18,
    paddingTop: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.09,
    shadowRadius: 28,
    width: '100%',
  },
  sectionRule: {
    backgroundColor: '#E2E8F0',
    height: StyleSheet.hairlineWidth,
    marginTop: 6,
  },
  sectionTitle: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  avatarBlock: {
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 0,
  },
  avatarImg: {
    borderRadius: AVATAR_SIZE / 2,
    height: AVATAR_SIZE,
    width: AVATAR_SIZE,
  },
  avatarPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#E5E7EB',
    justifyContent: 'center',
  },
  avatarRing: {
    borderRadius: AVATAR_SIZE / 2,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 6,
  },
  bioCounter: {
    bottom: 8,
    color: 'rgba(107, 114, 128, 0.65)',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.1,
    position: 'absolute',
    right: 12,
  },
  bioInput: {
    backgroundColor: 'transparent',
    borderRadius: BIO_RADIUS,
    color: TEXT_PRIMARY,
    fontSize: 14.5,
    lineHeight: 20,
    minHeight: 82,
    paddingBottom: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  bioWrap: {
    backgroundColor: INPUT_BG,
    borderRadius: BIO_RADIUS,
    minHeight: 82,
    overflow: 'hidden',
    position: 'relative',
  },
  birthPressable: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingVertical: 10,
  },
  birthRowShell: {
    alignItems: 'center',
    backgroundColor: INPUT_BG,
    borderRadius: PILL_RADIUS,
    flexDirection: 'row',
    minHeight: 48,
    paddingLeft: 16,
    paddingRight: 4,
  },
  changePhotoPill: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: ORANGE_SOFT_BG,
    borderRadius: PILL_RADIUS,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  changePhotoPillText: {
    color: ORANGE,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  clearBirthInner: {
    alignItems: 'center',
    borderRadius: 22,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  clearBirthSpacer: {
    height: 40,
    width: 8,
  },
  errorBannerInCard: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  errorBannerText: {
    color: '#B91C1C',
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    marginLeft: 8,
  },
  fieldBlock: {
    marginBottom: 8,
  },
  fieldBlockLast: {
    marginBottom: 0,
  },
  flagEmoji: {
    fontSize: 20,
    marginRight: 6,
  },
  flex: {
    flex: 1,
  },
  inputLikeText: {
    color: TEXT_PRIMARY,
    fontSize: 14.5,
  },
  dateIosBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  dateIosBackdropTap: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 48,
  },
  dateIosSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    paddingBottom: 20,
  },
  dateIosTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '700',
  },
  dateIosWheel: {
    height: 200,
  },
  iosPickerBar: {
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderBottomColor: '#E5E7EB',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  iosPickerDone: {
    color: ORANGE,
    fontSize: 16,
    fontWeight: '700',
  },
  phoneInputFlex: {
    flex: 1,
    marginTop: 0,
  },
  accountInfoIconWrap: {
    alignItems: 'center',
    backgroundColor: ORANGE_SOFT_BG,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    marginRight: 12,
    width: 40,
  },
  accountInfoLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
  },
  accountInfoRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    marginBottom: 18,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  accountInfoSubtitle: {
    color: PLACEHOLDER_COLOR,
    fontSize: 12,
    marginTop: 2,
  },
  accountInfoTextCol: {
    flex: 1,
  },
  accountInfoTitle: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '600',
  },
  countryList: {
    maxHeight: 360,
  },
  countryLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
  },
  countryModalBackdrop: {
    flexGrow: 1,
  },
  countryModalClose: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  countryModalHeader: {
    alignItems: 'center',
    borderBottomColor: '#E5E7EB',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 10,
  },
  countryModalRoot: {
    backgroundColor: 'rgba(0,0,0,0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  countryModalSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '88%',
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  countryModalTitle: {
    color: TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: '700',
  },
  countryRow: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  countryRowActive: {
    backgroundColor: ORANGE_SOFT_BG,
  },
  countryRowDial: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '600',
  },
  countryRowFlag: {
    fontSize: 22,
    marginRight: 10,
    width: 32,
  },
  countryRowIso: {
    color: PLACEHOLDER_COLOR,
    fontSize: 11,
    marginTop: 2,
  },
  countryRowMid: {
    flex: 1,
    marginRight: 8,
  },
  countryRowName: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    fontWeight: '500',
  },
  countrySearchInput: {
    backgroundColor: INPUT_BG,
    borderRadius: PILL_RADIUS,
    color: TEXT_PRIMARY,
    fontSize: 15,
    marginBottom: 10,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
  },
  phonePrefix: {
    alignItems: 'center',
    backgroundColor: INPUT_BG,
    borderRadius: 999,
    flexDirection: 'row',
    height: 48,
    justifyContent: 'center',
    marginRight: 10,
    minWidth: 94,
    paddingHorizontal: 10,
  },
  phonePrefixText: {
    color: '#1F2937',
    fontSize: 14,
    fontWeight: '600',
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  readonlyInput: {
    opacity: 0.62,
  },
  usernameStatusError: {
    color: '#B42318',
  },
  usernameStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    marginTop: 6,
    paddingLeft: 4,
  },
  usernameStatusSuccess: {
    color: '#15803D',
  },
  usernameStatusText: {
    color: '#64748B',
    fontSize: 11.5,
    fontWeight: '500',
  },
  placeholderLike: {
    color: '#9CA3AF',
    fontSize: 14.5,
  },
  pressedOpacity: {
    opacity: 0.88,
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  saveDisabled: {
    opacity: 0.55,
  },
  screen: {
    backgroundColor: SCREEN_BG,
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheetCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    elevation: 16,
    marginHorizontal: 0,
    maxHeight: '72%',
    overflow: 'hidden',
    paddingTop: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    width: '100%',
  },
  sheetGrabber: {
    alignSelf: 'center',
    backgroundColor: '#D1D5DB',
    borderRadius: 3,
    height: 4,
    marginBottom: 10,
    marginTop: 8,
    width: 36,
  },
  sheetRow: {
    alignItems: 'center',
    borderBottomColor: '#F3F4F6',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sheetRowActive: {
    backgroundColor: 'rgba(255, 99, 46, 0.08)',
  },
  sheetRowCheckSlot: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
  },
  sheetRowIndicator: {
    alignItems: 'center',
    borderColor: '#CBD5E1',
    borderRadius: 8,
    borderWidth: 1.5,
    height: 16,
    justifyContent: 'center',
    marginRight: 10,
    width: 16,
  },
  sheetRowIndicatorActive: {
    borderColor: ORANGE,
  },
  sheetRowIndicatorDot: {
    backgroundColor: ORANGE,
    borderRadius: 3.5,
    height: 7,
    width: 7,
  },
  sheetRowLabel: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 22,
  },
  sheetRowLeft: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
  },
  sheetTitle: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  stadiumInput: {
    backgroundColor: INPUT_BG,
    borderRadius: PILL_RADIUS,
    color: TEXT_PRIMARY,
    fontSize: 14.5,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
  },
  topCircleLight: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: TOP_BTN / 2,
    elevation: 4,
    height: TOP_BTN,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    width: TOP_BTN,
  },
  topCircleOrange: {
    alignItems: 'center',
    backgroundColor: ORANGE,
    borderRadius: TOP_BTN / 2,
    elevation: 5,
    height: TOP_BTN,
    justifyContent: 'center',
    shadowColor: ORANGE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    width: TOP_BTN,
  },
  topSaveMuted: {
    alignItems: 'center',
    backgroundColor: '#E5E7EB',
    borderRadius: TOP_BTN / 2,
    elevation: 2,
    height: TOP_BTN,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    width: TOP_BTN,
  },
});

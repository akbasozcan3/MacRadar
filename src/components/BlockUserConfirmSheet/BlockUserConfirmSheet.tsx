import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StatusBar,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import IosSpinner from '../IosSpinner/IosSpinner';
import { translateText } from '../../i18n/runtime';
import { Text } from '../../theme/typography';

const PRIMARY_BLUE = '#4d5dfa';

export type UserBlockReportReasonOption = {
  backendReason: string;
  icon: string;
  key: string;
  label: string;
};

export const USER_BLOCK_REPORT_REASON_OPTIONS: UserBlockReportReasonOption[] = [
  {
    backendReason: 'spam',
    icon: 'alert-octagon',
    key: 'spam',
    label: 'Spam',
  },
  {
    backendReason: 'harassment_or_bullying',
    icon: 'alert-triangle',
    key: 'harassment_or_bullying',
    label: 'Taciz veya zorbalık',
  },
  {
    backendReason: 'inappropriate_content',
    icon: 'eye-off',
    key: 'inappropriate_content',
    label: 'Uygunsuz içerik',
  },
  {
    backendReason: 'violence',
    icon: 'slash',
    key: 'violence',
    label: 'Şiddet',
  },
  {
    backendReason: 'hate_speech',
    icon: 'x-circle',
    key: 'hate_speech',
    label: 'Nefret söylemi',
  },
  {
    backendReason: 'other',
    icon: 'more-horizontal',
    key: 'other',
    label: 'Diğer',
  },
];

export type BlockUserConfirmSheetProps = {
  displayName?: string;
  onBlock: () => Promise<void>;
  onBlockAndReport: (reason: string) => Promise<void>;
  onClose: () => void;
  username: string;
  visible: boolean;
};

type SheetStep = 'confirm' | 'report';
type SubmitPhase = 'idle' | 'block' | 'report';

export default function BlockUserConfirmSheet({
  displayName,
  onBlock,
  onBlockAndReport,
  onClose,
  username,
  visible,
}: BlockUserConfirmSheetProps) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<SheetStep>('confirm');
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingReasonKey, setPendingReasonKey] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setStep('confirm');
      setPhase('idle');
      setErrorMessage(null);
      setPendingReasonKey(null);
    }
  }, [visible]);

  const titleName =
    username.trim().length > 0
      ? `@${username.replace(/^@/, '')}`
      : (displayName ?? '').trim() || translateText('Bu kullanıcı');

  const handleClose = useCallback(() => {
    if (phase !== 'idle') {
      return;
    }
    onClose();
  }, [onClose, phase]);

  const runBlock = useCallback(async () => {
    setErrorMessage(null);
    setPhase('block');
    try {
      await onBlock();
      onClose();
    } catch (e) {
      setErrorMessage(
        e instanceof Error ? e.message : translateText('İşlem tamamlanamadı.'),
      );
    } finally {
      setPhase('idle');
    }
  }, [onBlock, onClose]);

  const runReportThenBlock = useCallback(
    async (reason: string) => {
      setErrorMessage(null);
      setPhase('report');
      try {
        await onBlockAndReport(reason);
        onClose();
      } catch (e) {
        setErrorMessage(
          e instanceof Error ? e.message : translateText('İşlem tamamlanamadı.'),
        );
      } finally {
        setPhase('idle');
        setPendingReasonKey(null);
      }
    },
    [onBlockAndReport, onClose],
  );

  const sheetBottomPad = Math.max(insets.bottom, 12) + 8;

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent={true}
      transparent={true}
      visible={visible}
    >
      <StatusBar
        animated={true}
        backgroundColor="transparent"
        barStyle="dark-content"
        translucent={true}
      />
      <View className="flex-1 justify-end">
        <Pressable
          className="absolute inset-0 bg-black/45"
          disabled={phase !== 'idle'}
          onPress={handleClose}
        />

        <View
          className="w-full rounded-t-[28px] bg-white"
          style={{ paddingBottom: sheetBottomPad }}
        >
          <View className="items-center pt-3 pb-1">
            <View className="h-1 w-10 rounded-full bg-[#d1d5db]" />
          </View>

          {step === 'confirm' ? (
            <>
              <View className="px-5 pt-2 pb-4">
                <Text
                  allowFontScaling={false}
                  className="text-[18px] font-semibold leading-snug text-[#111827]"
                >
                  {titleName} {translateText('engellensin mi?')}
                </Text>
                <Text
                  allowFontScaling={false}
                  className="mt-3 text-[14px] leading-[21px] text-[#4b5563]"
                >
                  {translateText(
                    'İstediğin zaman Ayarlar > Engellenen kullanıcılar bölümünden engeli kaldırabilirsin.',
                  )}
                </Text>

                <View className="mt-5 gap-4">
                  <View className="flex-row gap-3">
                    <View className="mt-0.5 h-9 w-9 items-center justify-center rounded-full border border-[#e5e7eb]">
                      <FeatherIcon color="#111827" name="slash" size={18} />
                    </View>
                    <Text
                      allowFontScaling={false}
                      className="flex-1 text-[14px] leading-[21px] text-[#374151]"
                    >
                      {translateText(
                        'Sana mesaj gönderemez ve MacRadar\'da profilini veya paylaşımlarını bulamaz.',
                      )}
                    </Text>
                  </View>
                  <View className="flex-row gap-3">
                    <View className="mt-0.5 h-9 w-9 items-center justify-center rounded-full border border-[#e5e7eb]">
                      <FeatherIcon color="#111827" name="bell" size={18} />
                    </View>
                    <Text
                      allowFontScaling={false}
                      className="flex-1 text-[14px] leading-[21px] text-[#374151]"
                    >
                      {translateText(
                        'Engellediğin veya şikayet ettiğin kişiye bildirim gönderilmez.',
                      )}
                    </Text>
                  </View>
                </View>
              </View>

              {errorMessage ? (
                <View className="mx-5 mb-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
                  <Text
                    allowFontScaling={false}
                    className="text-[13px] text-rose-600"
                  >
                    {errorMessage}
                  </Text>
                </View>
              ) : null}

              <View className="px-5 pt-1">
                <Pressable
                  className="mb-3 h-[50px] items-center justify-center rounded-[14px]"
                  disabled={phase !== 'idle'}
                  onPress={() => {
                    void runBlock();
                  }}
                  style={{
                    backgroundColor: PRIMARY_BLUE,
                    opacity: phase !== 'idle' ? 0.65 : 1,
                  }}
                >
                  {phase === 'block' ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text
                      allowFontScaling={false}
                      className="text-[15px] font-semibold text-white"
                    >
                      {translateText('Engelle')}
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  className="py-3"
                  disabled={phase !== 'idle'}
                  hitSlop={10}
                  onPress={() => {
                    setErrorMessage(null);
                    setStep('report');
                  }}
                >
                  <Text
                    allowFontScaling={false}
                    className="text-center text-[15px] font-semibold"
                    style={{ color: PRIMARY_BLUE }}
                  >
                    {translateText('Engelle ve şikayet et')}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View className="flex-row items-center border-b border-[#eef0f4] px-3 pb-3 pt-1">
                <Pressable
                  className="h-10 w-10 items-center justify-center rounded-full active:bg-[#f3f4f6]"
                  disabled={Boolean(pendingReasonKey)}
                  onPress={() => {
                    setErrorMessage(null);
                    setStep('confirm');
                  }}
                >
                  <FeatherIcon color="#111827" name="chevron-left" size={26} />
                </Pressable>
                <Text
                  allowFontScaling={false}
                  className="flex-1 text-center text-[16px] font-semibold text-[#111827]"
                >
                  {translateText('Şikayet nedeni')}
                </Text>
                <View className="h-10 w-10" />
              </View>

              {errorMessage ? (
                <View className="mx-5 mb-2 mt-3 rounded-[12px] border border-rose-200 bg-rose-50 px-3 py-2.5">
                  <Text
                    allowFontScaling={false}
                    className="text-[13px] text-rose-600"
                  >
                    {errorMessage}
                  </Text>
                </View>
              ) : null}

              <View className="gap-3 px-5 pb-2 pt-4">
                {USER_BLOCK_REPORT_REASON_OPTIONS.map(option => {
                  const isPending = pendingReasonKey === option.key;
                  return (
                    <Pressable
                      className={`h-[68px] flex-row items-center rounded-[16px] border border-[#eceff3] bg-[#f7f8fb] px-4 ${pendingReasonKey && !isPending ? 'opacity-55' : ''
                        }`}
                      disabled={Boolean(pendingReasonKey) && !isPending}
                      key={option.key}
                      onPress={() => {
                        setPendingReasonKey(option.key);
                        void runReportThenBlock(option.backendReason);
                      }}
                    >
                      <View className="h-[36px] w-[36px] items-center justify-center rounded-full bg-white">
                        <FeatherIcon color="#ef4444" name={option.icon} size={17} />
                      </View>
                      <Text
                        allowFontScaling={false}
                        className="ml-3 flex-1 text-[14px] text-[#1f2937]"
                      >
                        {translateText(option.label)}
                      </Text>
                      {isPending ? (
                        <IosSpinner color="#9ca3af" size="small" />
                      ) : (
                        <FeatherIcon color="#a5acb7" name="chevron-right" size={20} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

import React from 'react';
import {
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';

import FeatherIcon from '../../components/FeatherIcon/FeatherIcon';
import IosSpinner from '../../components/IosSpinner/IosSpinner';
import { Text } from '../../theme/typography';

export const TODAY_MOOD_OPTIONS = [
  {
    description: 'Rota acik, enerji yuksek, bugun aktif gorunmek istiyorum.',
    icon: 'zap',
    value: 'Enerjik',
  },
  {
    description: 'Yoldayim, haritada aktif ama dengeli bir moddayim.',
    icon: 'navigation',
    value: 'Yoldayim',
  },
  {
    description: 'Sakin bir gun. Konum acik ama tempo dusuk.',
    icon: 'moon',
    value: 'Sakinim',
  },
  {
    description: 'Kahve, rota ve sohbet modu. Bugun keyif odakli.',
    icon: 'coffee',
    value: 'Kahve modunda',
  },
] as const;

type TodayMoodModalProps = {
  errorMessage: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSelect: (value: string) => void;
  safeBottom: number;
  visible: boolean;
};

export default function TodayMoodModal({
  errorMessage,
  isSaving,
  onClose,
  onSelect,
  safeBottom,
  visible,
}: TodayMoodModalProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent={false}
      transparent
      visible={visible}
    >
      <StatusBar
        animated={true}
        backgroundColor="#ffffff"
        barStyle="dark-content"
        hidden={false}
        translucent={false}
      />
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: safeBottom + 16 }]}>
          <View style={styles.heroBadge}>
            <FeatherIcon color="#2563eb" name="smile" size={18} />
          </View>
          <Text style={styles.eyebrow}>ILK GIRIS</Text>
          <Text style={styles.title}>Bugun nasilsin?</Text>
          <Text style={styles.subtitle}>
            Sectigin cevap haritadaki kendi marker'inin ustunde ve uye
            profilinde gorunur.
          </Text>

          <View style={styles.options}>
            {TODAY_MOOD_OPTIONS.map(option => (
              <Pressable
                key={option.value}
                className="active:opacity-85"
                disabled={isSaving}
                onPress={() => onSelect(option.value)}
                style={styles.optionCard}
              >
                <View style={styles.optionIcon}>
                  <FeatherIcon color="#2563eb" name={option.icon} size={18} />
                </View>
                <View style={styles.optionCopy}>
                  <Text style={styles.optionTitle}>{option.value}</Text>
                  <Text style={styles.optionDescription}>
                    {option.description}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>

          {errorMessage ? (
            <View style={styles.errorCard}>
              <FeatherIcon color="#b42318" name="alert-circle" size={15} />
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          ) : null}

          <Pressable
            className="active:opacity-80"
            disabled={isSaving}
          onPress={onClose}
          style={styles.secondaryAction}
        >
          {isSaving ? (
            <IosSpinner size="small" />
          ) : (
            <Text style={styles.secondaryActionText}>Simdi degil</Text>
          )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(2, 6, 23, 0.62)',
    paddingHorizontal: 12,
    paddingTop: 24,
  },
  sheet: {
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 1,
    borderColor: '#dce5ef',
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  heroBadge: {
    width: 46,
    height: 46,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f0ff',
  },
  eyebrow: {
    marginTop: 14,
    color: '#2563eb',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.3,
  },
  title: {
    marginTop: 8,
    color: '#0f172a',
    fontSize: 28,
    lineHeight: 32,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 10,
    color: '#526072',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
  },
  options: {
    marginTop: 18,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#dce5ef',
    backgroundColor: '#f8fbff',
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 10,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#edf4ff',
  },
  optionCopy: {
    flex: 1,
    marginLeft: 12,
  },
  optionTitle: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '800',
  },
  optionDescription: {
    marginTop: 4,
    color: '#526072',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  errorCard: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 18,
    backgroundColor: '#fef2f2',
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  errorText: {
    marginLeft: 8,
    flex: 1,
    color: '#991b1b',
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  secondaryAction: {
    marginTop: 12,
    height: 50,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#dce5ef',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
  },
});

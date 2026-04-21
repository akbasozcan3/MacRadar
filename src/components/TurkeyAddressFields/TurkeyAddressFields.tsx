import React, { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';

import FeatherIcon from '../FeatherIcon/FeatherIcon';
import { sortTurkeyProvincesForDisplay } from '../../data/turkeyProvinces';
import { Text, TextInput } from '../../theme/typography';

export type TurkeyStructuredAddress = {
  addressLine: string;
  district: string;
  province: string;
};

type TurkeyAddressFieldsProps = {
  addressLine: string;
  district: string;
  onChange: (next: TurkeyStructuredAddress) => void;
  province: string;
};

function TurkeyAddressFields({
  addressLine,
  district,
  onChange,
  province,
}: TurkeyAddressFieldsProps) {
  const [provinceModalOpen, setProvinceModalOpen] = useState(false);
  const [provinceSearch, setProvinceSearch] = useState('');

  const sortedProvinces = useMemo(() => sortTurkeyProvincesForDisplay(), []);

  const filteredProvinces = useMemo(() => {
    const q = provinceSearch.trim().toLocaleLowerCase('tr-TR');
    if (!q) {
      return sortedProvinces;
    }
    return sortedProvinces.filter(p =>
      p.toLocaleLowerCase('tr-TR').includes(q),
    );
  }, [provinceSearch, sortedProvinces]);

  const openProvinceModal = useCallback(() => {
    setProvinceSearch('');
    setProvinceModalOpen(true);
  }, []);

  const closeProvinceModal = useCallback(() => {
    setProvinceModalOpen(false);
  }, []);

  const handlePickProvince = useCallback(
    (name: string) => {
      onChange({
        addressLine,
        district,
        province: name,
      });
      setProvinceModalOpen(false);
    },
    [addressLine, district, onChange],
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.sectionLabel}>Türkiye adresi</Text>
      <Text style={styles.sectionHint}>
        İl ve ilçe seçin; mahalle, sokak ve numarayı ayrıntı alanına yazın. İsterseniz
        aşağıdaki harita önerilerini de kullanabilirsiniz.
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={openProvinceModal}
        style={({ pressed }) => [
          styles.selectRow,
          pressed ? styles.selectRowPressed : null,
        ]}
      >
        <View style={styles.selectIcon}>
          <FeatherIcon color="#64748b" name="map-pin" size={16} />
        </View>
        <View style={styles.selectTextWrap}>
          <Text style={styles.selectLabel}>İl</Text>
          <Text style={province ? styles.selectValue : styles.selectPlaceholder}>
            {province.trim().length > 0 ? province : 'İl seçin'}
          </Text>
        </View>
        <View style={styles.selectChevron}>
          <FeatherIcon color="#94a3b8" name="chevron-down" size={18} />
        </View>
      </Pressable>

      <View style={styles.fieldBlock}>
        <Text style={styles.inlineLabel}>İlçe</Text>
        <TextInput
          allowFontScaling={false}
          autoCapitalize="words"
          autoCorrect={false}
          onChangeText={value => {
            onChange({
              addressLine,
              district: value,
              province,
            });
          }}
          placeholder="Örn. Kadıköy"
          placeholderTextColor="#94a3b8"
          style={styles.textField}
          value={district}
        />
      </View>

      <View style={styles.fieldBlock}>
        <Text style={styles.inlineLabel}>Mahalle, sokak, bina no</Text>
        <TextInput
          allowFontScaling={false}
          autoCapitalize="sentences"
          multiline
          numberOfLines={2}
          onChangeText={value => {
            onChange({
              addressLine: value,
              district,
              province,
            });
          }}
          placeholder="Açık adres satırı"
          placeholderTextColor="#94a3b8"
          style={[styles.textField, styles.textFieldMultiline]}
          textAlignVertical="top"
          value={addressLine}
        />
      </View>

      <Modal
        animationType="fade"
        onRequestClose={closeProvinceModal}
        transparent
        visible={provinceModalOpen}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityRole="button"
            onPress={closeProvinceModal}
            style={styles.modalBackdropFill}
          />
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>İl seçin</Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={closeProvinceModal}
                style={styles.modalClose}
              >
                <FeatherIcon color="#64748b" name="x" size={20} />
              </Pressable>
            </View>
            <TextInput
              allowFontScaling={false}
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setProvinceSearch}
              placeholder="İl ara..."
              placeholderTextColor="#94a3b8"
              style={styles.modalSearch}
              value={provinceSearch}
            />
            <FlatList
              data={filteredProvinces}
              keyboardShouldPersistTaps="handled"
              keyExtractor={item => item}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    handlePickProvince(item);
                  }}
                  style={({ pressed }) => [
                    styles.provinceRow,
                    pressed ? styles.provinceRowPressed : null,
                  ]}
                >
                  <Text style={styles.provinceRowText}>{item}</Text>
                </Pressable>
              )}
              style={styles.provinceList}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default memo(TurkeyAddressFields);

const styles = StyleSheet.create({
  fieldBlock: {
    marginTop: 10,
  },
  inlineLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  modalBackdrop: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalBackdropFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    maxHeight: '78%',
    paddingBottom: 12,
    paddingTop: 14,
    width: '100%',
    zIndex: 1,
  },
  modalClose: {
    padding: 4,
  },
  modalHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  modalSearch: {
    borderColor: '#e2e8f0',
    borderRadius: 12,
    borderWidth: 1,
    color: '#0f172a',
    fontSize: 15,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modalTitle: {
    color: '#0f172a',
    fontSize: 17,
    fontWeight: '800',
  },
  provinceList: {
    marginTop: 8,
    maxHeight: 360,
  },
  provinceRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  provinceRowPressed: {
    backgroundColor: '#f8fafc',
  },
  provinceRowText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '600',
  },
  sectionHint: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 12,
  },
  sectionLabel: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  selectLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  selectPlaceholder: {
    color: '#94a3b8',
    fontSize: 15,
    fontWeight: '600',
  },
  selectChevron: {
    marginLeft: 8,
  },
  selectIcon: {
    marginRight: 10,
  },
  selectRow: {
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectRowPressed: {
    opacity: 0.92,
  },
  selectTextWrap: {
    flex: 1,
  },
  selectValue: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
  },
  textField: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    borderRadius: 14,
    borderWidth: 1,
    color: '#0f172a',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textFieldMultiline: {
    minHeight: 72,
    paddingTop: 12,
  },
  wrap: {
    marginBottom: 4,
    marginTop: 4,
  },
});

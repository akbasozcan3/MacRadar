import type React from 'react';

import type { AppLanguage } from '../types/AuthTypes/AuthTypes';

import enFallback from './bundles/en.json';

type LanguageListener = (next: AppLanguage) => void;

let activeLanguage: AppLanguage = 'tr';
const languageListeners = new Set<LanguageListener>();

const EN_FALLBACK: Record<string, string> = enFallback;

let remoteEnStrings: Record<string, string> | null = null;
let cachedEnMap: Record<string, string> = EN_FALLBACK;
let cachedNormalizedEn: Record<string, string> = buildNormalizedMap(EN_FALLBACK);

function buildNormalizedMap(source: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      normalizeLookupText(key),
      value,
    ]),
  ) as Record<string, string>;
}

function rebuildEnglishCache() {
  const merged = remoteEnStrings
    ? { ...EN_FALLBACK, ...remoteEnStrings }
    : EN_FALLBACK;
  cachedEnMap = merged;
  cachedNormalizedEn = buildNormalizedMap(merged);
}

function normalizeLookupText(value: string) {
  return value
    .replace(/\u0130/gu, 'i')
    .replace(/\u0131/gu, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/\s+/gu, ' ')
    .toLowerCase()
    .trim();
}

function translateByPattern(input: string) {
  const patternRules: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^cekildi:\s*(.+)$/iu, match => `Captured: ${match[1]}`],
    [/^(\d+)\s+bekleyen$/iu, match => `${match[1]} pending`],
    [/^(\d+) gelen istek$/iu, match => `${match[1]} incoming requests`],
    [/^Simdi once$/iu, () => 'Just now'],
    [/^(\d+)\s+dk\s+once$/iu, match => `${match[1]}m ago`],
    [/^(\d+)\s+sa\s+once$/iu, match => `${match[1]}h ago`],
    [/^(\d+)\s+g\s+once$/iu, match => `${match[1]}d ago`],
    [/^Kod kalan sure: (\d+)s$/iu, match => `Time left: ${match[1]}s`],
    [/^Tekrar gönder \((\d+)s\)$/iu, match => `Resend (${match[1]}s)`],
    [
      /^Kod (.+?) adresine gonderildi\. Son gecerlilik: (.+)$/iu,
      match => `Code sent to ${match[1]}. Expires: ${match[2]}`,
    ],
    [/^(\d+)\s+yeni takip istegi$/iu, match => `${match[1]} new follow requests`],
    [/^tumunu goster \((\d+)\)$/iu, match => `Show all (${match[1]})`],
    [/^son istek @(.+)$/iu, match => `Latest request @${match[1]}`],
    [/^(\d+)\s*dk$/iu, match => `${match[1]}m`],
    [/^(\d+)\s*sa$/iu, match => `${match[1]}h`],
    [/^(\d+)\s*g$/iu, match => `${match[1]}d`],
    [/^(\d+) yeni istek geldi$/iu, match => `${match[1]} new requests`],
    [/^(\d+) yeni takip isteği$/iu, match => `${match[1]} new follow requests`],
    [/^(\d+) yeni Yakındakiler isteği$/iu, match => `${match[1]} new nearby requests`],
    [/^kalan deneme: (\d+)\.$/iu, match => `Remaining attempts: ${match[1]}.`],
    [
      /^kayit acik ([0-9]{2}:[0-9]{2}) · tekrar dokun gonder$/iu,
      match => `Recording ${match[1]} · tap again to send`,
    ],
    [
      /^kayit ([0-9]{2}:[0-9]{2}) · birak ve gonder$/iu,
      match => `Recording ${match[1]} · release to send`,
    ],
    [
      /^bio en fazla (\d+) karakter olabilir\.$/iu,
      match => `Bio can be at most ${match[1]} characters.`,
    ],
    [
      /^sehir en fazla (\d+) karakter olabilir\.$/iu,
      match => `City can be at most ${match[1]} characters.`,
    ],
    [
      /^favori arac en fazla (\d+) karakter olabilir\.$/iu,
      match => `Favorite car can be at most ${match[1]} characters.`,
    ],
    [
      /^durum mesaji en fazla (\d+) karakter olabilir\.$/iu,
      match => `Status message can be at most ${match[1]} characters.`,
    ],
  ];

  for (const [regex, resolver] of patternRules) {
    const match = input.match(regex);
    if (match) {
      return resolver(match);
    }
  }

  return null;
}

export function getAppLanguage() {
  return activeLanguage;
}

export function setAppLanguage(next: AppLanguage) {
  if (next === activeLanguage) {
    return;
  }

  activeLanguage = next;
  languageListeners.forEach(listener => {
    listener(next);
  });
}

export function subscribeAppLanguage(listener: LanguageListener) {
  languageListeners.add(listener);
  return () => {
    languageListeners.delete(listener);
  };
}

/**
 * Merges server-provided English strings over the shipped fallback map.
 * Passing null clears the overlay (offline / non-English).
 */
export function setRemoteEnglishStrings(next: Record<string, string> | null) {
  remoteEnStrings = next;
  rebuildEnglishCache();
  const lang = activeLanguage;
  languageListeners.forEach(listener => {
    listener(lang);
  });
}

export function translateText(input: string, language: AppLanguage = activeLanguage) {
  if (language !== 'en' || input.trim().length === 0) {
    return input;
  }

  const leading = input.match(/^\s*/u)?.[0] ?? '';
  const trailing = input.match(/\s*$/u)?.[0] ?? '';
  const core = input.trim();
  const normalizedCore = normalizeLookupText(core);
  const translated =
    cachedEnMap[core] ??
    cachedNormalizedEn[normalizedCore] ??
    translateByPattern(core) ??
    translateByPattern(normalizedCore) ??
    core;

  return `${leading}${translated}${trailing}`;
}

export function translateReactNode(node: React.ReactNode): React.ReactNode {
  if (typeof node === 'string') {
    return translateText(node);
  }

  if (Array.isArray(node)) {
    return node.map(translateReactNode);
  }

  return node;
}

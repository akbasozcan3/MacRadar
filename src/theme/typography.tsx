import React, { forwardRef } from 'react';
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { translateReactNode, translateText } from '../i18n/runtime';

declare const process:
  | {
      env?: {
        JEST_WORKER_ID?: string;
      };
    }
  | undefined;

const POPPINS_BY_WEIGHT = {
  '100': 'Poppins-Thin',
  '200': 'Poppins-ExtraLight',
  '300': 'Poppins-Light',
  '400': 'Poppins-Regular',
  '500': 'Poppins-Medium',
  '600': 'Poppins-SemiBold',
  '700': 'Poppins-Bold',
  '800': 'Poppins-ExtraBold',
  '900': 'Poppins-Black',
} as const;

const POPPINS_ITALIC_BY_WEIGHT = {
  '100': 'Poppins-ThinItalic',
  '200': 'Poppins-ExtraLightItalic',
  '300': 'Poppins-LightItalic',
  '400': 'Poppins-Italic',
  '500': 'Poppins-MediumItalic',
  '600': 'Poppins-SemiBoldItalic',
  '700': 'Poppins-BoldItalic',
  '800': 'Poppins-ExtraBoldItalic',
  '900': 'Poppins-BlackItalic',
} as const;

type SupportedWeight = keyof typeof POPPINS_BY_WEIGHT;

type CssInterop = <TComponent>(
  component: TComponent,
  mapping: Record<string, string>,
) => TComponent;

function createCssInterop(): CssInterop {
  if (typeof process !== 'undefined' && process?.env?.JEST_WORKER_ID != null) {
    return component => component;
  }

  if (
    typeof globalThis === 'object' &&
    'jest' in globalThis &&
    globalThis.jest != null
  ) {
    return component => component;
  }

  try {
    const nativewind = require('nativewind') as { cssInterop?: CssInterop };

    return nativewind.cssInterop ?? (component => component);
  } catch {
    return component => component;
  }
}

const cssInterop: CssInterop = createCssInterop();

const POPPINS_FAMILIES = new Set<string>([
  'Poppins',
  ...Object.values(POPPINS_BY_WEIGHT),
  ...Object.values(POPPINS_ITALIC_BY_WEIGHT),
]);

function normalizeFontFamily(fontFamily?: string) {
  return fontFamily?.replace(/['"]/g, '').trim();
}

function inferWeightFromPoppinsFont(fontFamily?: string): SupportedWeight {
  const normalized = normalizeFontFamily(fontFamily);

  if (!normalized || !normalized.startsWith('Poppins')) {
    return '400';
  }

  if (normalized.includes('Black')) {
    return '900';
  }

  if (normalized.includes('ExtraBold')) {
    return '800';
  }

  if (normalized.includes('SemiBold')) {
    return '600';
  }

  if (normalized.includes('Bold')) {
    return '700';
  }

  if (normalized.includes('Medium')) {
    return '500';
  }

  if (normalized.includes('Light') && normalized.includes('Extra')) {
    return '200';
  }

  if (normalized.includes('Light')) {
    return '300';
  }

  if (normalized.includes('Thin')) {
    return '100';
  }

  return '400';
}

function normalizeFontWeight(
  fontWeight?: TextStyle['fontWeight'],
  fallback: SupportedWeight = '400',
): SupportedWeight {
  const rawWeight =
    typeof fontWeight === 'number' ? String(fontWeight) : fontWeight?.trim();

  switch (rawWeight) {
    case '100':
    case 'thin':
      return '100';
    case '200':
    case 'ultralight':
    case 'extra-light':
      return '200';
    case '300':
    case 'light':
      return '300';
    case '500':
    case 'medium':
      return '500';
    case '600':
    case 'semibold':
    case 'semi-bold':
      return '600';
    case '700':
    case 'bold':
      return '700';
    case '800':
    case 'extrabold':
    case 'extra-bold':
    case 'heavy':
      return '800';
    case '900':
    case 'black':
      return '900';
    case '400':
    case 'normal':
    case undefined:
      return fallback;
    default: {
      const numericWeight = Number.parseInt(rawWeight ?? '', 10);

      if (!Number.isNaN(numericWeight)) {
        if (numericWeight <= 150) {
          return '100';
        }

        if (numericWeight <= 250) {
          return '200';
        }

        if (numericWeight <= 350) {
          return '300';
        }

        if (numericWeight <= 450) {
          return '400';
        }

        if (numericWeight <= 550) {
          return '500';
        }

        if (numericWeight <= 650) {
          return '600';
        }

        if (numericWeight <= 750) {
          return '700';
        }

        if (numericWeight <= 850) {
          return '800';
        }

        return '900';
      }

      return fallback;
    }
  }
}

function shouldKeepCustomFont(fontFamily?: string) {
  const normalized = normalizeFontFamily(fontFamily);

  return Boolean(normalized && !POPPINS_FAMILIES.has(normalized));
}

export function resolvePoppinsStyle(style?: StyleProp<TextStyle>) {
  const flattened = StyleSheet.flatten(style) ?? {};

  if (shouldKeepCustomFont(flattened.fontFamily)) {
    return null;
  }

  const fallbackWeight = inferWeightFromPoppinsFont(flattened.fontFamily);
  const fontWeight = normalizeFontWeight(flattened.fontWeight, fallbackWeight);
  const isItalic =
    flattened.fontStyle === 'italic' ||
    normalizeFontFamily(flattened.fontFamily)?.endsWith('Italic') === true;

  return {
    fontFamily: isItalic
      ? POPPINS_ITALIC_BY_WEIGHT[fontWeight]
      : POPPINS_BY_WEIGHT[fontWeight],
    fontStyle: undefined,
    fontWeight: undefined,
  } satisfies TextStyle;
}

function mergeTypographyStyle(style?: StyleProp<TextStyle>) {
  const fontStyle = resolvePoppinsStyle(style);

  if (!fontStyle) {
    return style;
  }

  return style ? [style, fontStyle] : fontStyle;
}

type PatchedComponent = {
  defaultProps?: { style?: StyleProp<TextStyle> };
  render?: (...args: unknown[]) => React.ReactElement | null;
  __macRadarPoppinsPatched__?: boolean;
};

type TypographyElementProps = {
  style?: StyleProp<TextStyle>;
};

function patchTypography(Component: PatchedComponent) {
  if (!Component || Component.__macRadarPoppinsPatched__) {
    return;
  }

  const originalRender = Component.render;

  if (typeof originalRender === 'function') {
    Component.render = function patchedRender(
      this: unknown,
      ...args: unknown[]
    ) {
      const element = originalRender.apply(this, args);

      if (!React.isValidElement<TypographyElementProps>(element)) {
        return element;
      }

      return React.cloneElement<TypographyElementProps>(element, {
        style: mergeTypographyStyle(element.props.style),
      });
    };
    Component.__macRadarPoppinsPatched__ = true;
    return;
  }

  Component.defaultProps = {
    ...(Component.defaultProps ?? {}),
    style: mergeTypographyStyle(Component.defaultProps?.style),
  };
  Component.__macRadarPoppinsPatched__ = true;
}

let globalTypographyInstalled = false;
let createElementPatched = false;

export function installGlobalTypography() {
  if (globalTypographyInstalled) {
    return;
  }

  if (!createElementPatched) {
    const originalCreateElement = React.createElement;

    React.createElement = ((
      type: React.ElementType,
      props: { placeholder?: string; style?: StyleProp<TextStyle> } | null,
      ...children: React.ReactNode[]
    ) => {
      if (type === RNText) {
        const nextProps = props
          ? { ...props, style: mergeTypographyStyle(props.style) }
          : { style: mergeTypographyStyle(undefined) };
        const translatedChildren = children.map(translateReactNode);

        return originalCreateElement(type, nextProps, ...translatedChildren);
      }

      if (type === RNTextInput) {
        const translatedPlaceholder =
          props && typeof props.placeholder === 'string'
            ? translateText(props.placeholder)
            : props?.placeholder;
        const nextProps = props
          ? {
              ...props,
              placeholder: translatedPlaceholder,
              style: mergeTypographyStyle(props.style),
            }
          : { style: mergeTypographyStyle(undefined) };

        return originalCreateElement(type, nextProps, ...children);
      }

      return originalCreateElement(type, props, ...children);
    }) as typeof React.createElement;

    createElementPatched = true;
  }

  patchTypography(RNText as unknown as PatchedComponent);
  patchTypography(RNTextInput as unknown as PatchedComponent);
  globalTypographyInstalled = true;
}

const TypographyText = forwardRef<
  React.ElementRef<typeof RNText>,
  React.ComponentProps<typeof RNText>
>(({ style, ...props }, ref) => {
  const translatedChildren = React.Children.map(props.children, translateReactNode);
  return (
    <RNText ref={ref} {...props} style={mergeTypographyStyle(style)}>
      {translatedChildren}
    </RNText>
  );
});

TypographyText.displayName = 'TypographyText';

const TypographyTextInput = forwardRef<
  React.ElementRef<typeof RNTextInput>,
  React.ComponentProps<typeof RNTextInput>
>(({ style, ...props }, ref) => {
  const translatedPlaceholder =
    typeof props.placeholder === 'string'
      ? translateText(props.placeholder)
      : props.placeholder;
  return (
    <RNTextInput
      ref={ref}
      {...props}
      placeholder={translatedPlaceholder}
      style={mergeTypographyStyle(style)}
    />
  );
});

TypographyTextInput.displayName = 'TypographyTextInput';

export const Text = cssInterop(TypographyText, {
  className: 'style',
});

export const TextInput = cssInterop(TypographyTextInput, {
  className: 'style',
});

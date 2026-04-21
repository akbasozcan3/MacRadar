import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';

import { Text } from '../../theme/typography';

type BrandIconProps = {
    name: 'google' | 'facebook';
    color?: string;
    size?: number;
};

type VectorSupport = 'checking' | 'ready' | 'fallback';

type BrandModuleShape = React.ComponentType<any> & {
    getImageSource?: (
        name: string,
        size?: number,
        color?: string,
    ) => Promise<unknown>;
};

let BrandModule: BrandModuleShape | null = null;
let vectorSupport: VectorSupport = 'checking';
let vectorSupportPromise: Promise<void> | null = null;

try {
    const loadedModule = require('react-native-vector-icons/FontAwesome');
    BrandModule = (loadedModule.default ?? loadedModule) as BrandModuleShape;
} catch {
    BrandModule = null;
}

function ensureVectorSupport() {
    if (vectorSupport !== 'checking') {
        return Promise.resolve();
    }

    if (!vectorSupportPromise) {
        if (!BrandModule) {
            vectorSupport = 'fallback';
            return Promise.resolve();
        }

        vectorSupportPromise = Promise.resolve()
            .then(() => BrandModule?.getImageSource?.('google', 16, '#ffffff'))
            .then(() => {
                vectorSupport = 'ready';
            })
            .catch(() => {
                vectorSupport = 'fallback';
            });
    }

    return vectorSupportPromise;
}

const FallbackGlyphs: Record<string, string> = {
    google: 'G',
    facebook: 'F',
};

export default function BrandIcon({
    name,
    color = '#ffffff',
    size = 20,
}: BrandIconProps) {
    const [supportState, setSupportState] = useState<VectorSupport>(vectorSupport);

    useEffect(() => {
        let mounted = true;
        ensureVectorSupport().finally(() => {
            if (mounted) {
                setSupportState(vectorSupport);
            }
        });
        return () => {
            mounted = false;
        };
    }, []);

    if (BrandModule && supportState === 'ready') {
        return (
            <BrandModule
                color={color}
                name={name}
                size={size}
            />
        );
    }

    return (
        <Text style={[styles.fallback, { color, fontSize: size }]}>
            {FallbackGlyphs[name] ?? '*'}
        </Text>
    );
}

const styles = StyleSheet.create({
    fallback: {
        fontWeight: '700',
    },
});

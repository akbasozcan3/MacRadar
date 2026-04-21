# Android Release Signing

Bu proje Android `release` build icin iki moda sahiptir:

- `MACRADAR_UPLOAD_*` degiskenleri tanimliysa: production keystore ile imzalar.
- Degiskenler tanimli degilse: build debug keystore ile imzalanir (yalnizca test icin).

## 1) Keystore olustur

```bash
keytool -genkeypair -v -keystore macradar-upload-key.keystore -alias macradar-upload -keyalg RSA -keysize 2048 -validity 10000
```

## 2) Degiskenleri ayarla

Asagidaki degerleri CI secrets veya yerel shell env olarak tanimla:

- `MACRADAR_UPLOAD_STORE_FILE` (ornek: `C:/path/to/macradar-upload-key.keystore`)
- `MACRADAR_UPLOAD_STORE_PASSWORD`
- `MACRADAR_UPLOAD_KEY_ALIAS`
- `MACRADAR_UPLOAD_KEY_PASSWORD`

## 3) Release APK al

```bash
cd android
./gradlew assembleRelease
```

Cikti:

- `android/app/build/outputs/apk/release/app-release.apk`

## 4) Imza dogrulama

```bash
apksigner verify --verbose --print-certs android/app/build/outputs/apk/release/app-release.apk
```

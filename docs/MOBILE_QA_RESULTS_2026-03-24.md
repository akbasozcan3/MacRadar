# Mobile QA Results

## Build Bilgisi

- Tarih: 2026-03-24 17:19:13 +03:00
- Cihaz: Masaustu test ortami (fiziksel cihaz turu beklemede)
- Isletim sistemi: Windows
- App surumu/commit: `85d43a6`
- Backend modu: `go` (otomatik dogrulama)
- App smoke testleri: `__tests__/AppShell.session-invalidation.test.tsx`, `__tests__/AppShell.tabs-navigation-smoke.test.tsx`

## Tab Sonuclari

### Home
- Durum: PASS (backend-contract + app-smoke)
- Notlar: `map/preferences` GET/PATCH akisi ve AppShell tab gecisi dogrulandi.

### Explore
- Durum: PASS (backend-contract + app-smoke)
- Notlar: feed, user search, post search, trending-tags endpointleri ve AppShell tab gecisi dogrulandi.

### Camera
- Durum: PASS (backend-contract)
- Notlar: profil post create/list akisi dogrulandi; kamera aksiyonunun unsupported cihazda guvenli fallback verdigi smoke testte goruldu.

### Messages
- Durum: PASS (backend-contract + app-smoke)
- Notlar: conversation create/list/send/read + voice upload + voice file fetch (sender/recipient) ve AppShell tab gecisi dogrulandi.

### Profile
- Durum: PASS (backend-contract + app-smoke)
- Notlar: app-settings, privacy, help, blocked-users, request-summary ve AppShell tab gecisi dogrulandi.

## Kritik Senaryolar

- Login / logout
  - Durum: PASS
  - Not: Auth smoke testleri gecti.
- Session invalidation (401 sonrasi login ekranina donus)
  - Durum: PASS (app-logic test + verify)
  - Not: `__tests__/AppShell.session-invalidation.test.tsx` ile unauthorized callback sonrasi login ekranina donus ve session temizleme dogrulandi; fiziksel cihazdaki UX gecisi manuel turda tekrar kontrol edilecek.
- Voice mesaj
  - upload
  - waveform
  - progress bar
  - hiz secimi `1x/1.25x/1.5x/2x`
  - hiz kaliciligi
  - Durum: PASS (backend + app logic)
  - Not: Backend voice upload/file endpointleri ve mesaj akisi test edildi; fiziksel cihaz ses deneyimi turu beklemede.
- Profile settings persistence
  - account
  - privacy
  - app settings
  - blocked users
  - Durum: PASS (backend-contract)
  - Not: API seviyesinde kalicilik dogrulandi.

## Hata Listesi

- `[SEV-2] [Manual QA] Fiziksel cihaz UI turu (Home/Explore/Camera/Messages/Profile) henuz tamamlanmadi.`

## Final Karar

- Release durumu: CONDITIONAL-GO
- Acik blocker sayisi: 1
- Sonraki aksiyon: Fiziksel cihazda manuel QA turunu tamamla; blockerlar kapaninca GO.

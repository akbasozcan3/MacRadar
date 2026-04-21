# Mobile QA Results Template

Bu dosya, cihaz uzerindeki manuel QA turundan sonra bulgulari hizli toplamak icindir.

## Build Bilgisi

- Tarih:
- Cihaz:
- Isletim sistemi:
- App surumu/commit:
- Backend modu: (`go` / `node`)

## Tab Sonuclari

### Home
- Durum: PASS / FAIL
- Notlar:

### Explore
- Durum: PASS / FAIL
- Notlar:

### Camera
- Durum: PASS / FAIL
- Notlar:

### Messages
- Durum: PASS / FAIL
- Notlar:

### Profile
- Durum: PASS / FAIL
- Notlar:

## Kritik Senaryolar

- Login / logout
  - Durum: PASS / FAIL
  - Not:
- Session invalidation (401 sonrasi login ekranina donus)
  - Durum: PASS / FAIL
  - Not:
- Voice mesaj
  - upload
  - waveform
  - progress bar
  - hiz secimi `1x/1.25x/1.5x/2x`
  - hiz kaliciligi
  - Durum: PASS / FAIL
  - Not:
- Profile settings persistence
  - account
  - privacy
  - app settings
  - blocked users
  - Durum: PASS / FAIL
  - Not:

## Hata Listesi

Her hata icin tek satir:

- `[SEV-1|SEV-2|SEV-3] [TAB] Kisa baslik - tekrar adimlari - beklenen/gerceklesen`

## Final Karar

- Release durumu: GO / NO-GO
- Acik blocker sayisi:
- Sonraki aksiyon:

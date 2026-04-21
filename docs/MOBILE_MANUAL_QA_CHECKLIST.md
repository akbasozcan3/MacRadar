# Mobile Manual QA Checklist

Bu dokuman Home / Explore / Camera / Messages / Profile akislari icin cihaz uzerinde hizli ama kapsamli bir QA turu icindir.

## 1. Hazirlik

- `npm run backend:test:all` komutunu bir kez calistir.
- `npm run start` ile uygulamayi ac.
- Test hesabi ile giris yap.

Beklenen:
- Login sonrasi Home tab acilir.
- Coklu tab gecislerinde crash veya beyaz ekran olmaz.

## 2. Home (Map)

- Harita acilisini kontrol et.
- Map menu butonuna basip:
  - map gorunum modu degistir,
  - tracking ac/kapa,
  - local/remote katmanlarini ac/kapa.
- Street friends panelini ac/kapat.

Beklenen:
- Ayarlar kaybolmadan geri gelir.
- Harita menusu kapaninca aktif secimler korunur.
- Konum/izin hatalarinda acik hata metni gorunur.

## 3. Explore

- Feed yuklemesini kontrol et.
- Search panelinde:
  - user aramasi yap,
  - post aramasi yap,
  - bir public profile ac.
- Bir profile follow ve street-friend aksiyonlarini dene.

Beklenen:
- Feed/listelerde tekrar eden kayit veya kilitlenme olmaz.
- Arama sonuclari backendden gelir.
- Public profile acilir, gizli hesap kurallari dogru uygulanir.

## 4. Camera

- Camera modalini ac.
- Photo cek ve paylas.
- Video cek (kisa), paylas.
- Cift dokunma ile kamera cevirme ve flash toggle davranisini kontrol et.

Beklenen:
- Capture sonrasi preview acilir.
- Paylasilan icerik profil post listesine duser.
- Izin yoksa yonlendirici hata/ayar butonlari gorunur.

## 5. Messages

- Konusma listesi acilsin.
- Yeni konusma olustur.
- Metin mesaj gonder/al.
- Sesli mesaj kaydet-gonder.
- Gelen sesli mesajda:
  - waveform gorunsun,
  - progress bar aksin,
  - hiz secenekleri `1x / 1.25x / 1.5x / 2x` dongusu calissin.
- Ekrani kapatip geri acarak secilen hiz kaliciligini kontrol et.

Beklenen:
- Okundu bilgisi ve unread badge dogru guncellenir.
- Sesli mesaj oynatma/surdurme sorunsuz calisir.
- Hiz tercihi kullanici bazli korunur.

## 6. Profile

- Profile ana ekraninda post/liked/saved sekmeleri arasinda gec.
- Settings icine gir ve su alanlari test et:
  - Account: ad soyad, dogum yili, sehir, favori arac, durum mesaji
  - Privacy: gizli hesap ve map gorunurlugu
  - Notifications
  - Profile preferences: cinsiyet, bildirimler, dil
  - Blocked users: engelle/engel kaldir
  - Help/About acilis kontrolu

Beklenen:
- Kaydet butonlari degisiklik yokken pasif/uygun mesajli olur.
- Profil ayarlari backendde kalici saklanir (ekrani kapatip acinca korunur).

## 7. Regression

- Logout / login tekrar et.
- Her tabi en az bir kez yeniden ac.
- Arkaplandan onplana donus yap (uygulamayi kapatmadan).

Beklenen:
- Session dusmedikce kullanici cikis ekranina atilmaz.
- Session gecersiz ise guvenli sekilde login ekranina doner.

## 8. Hata Kriterleri

Asagidaki durumlardan biri varsa release bloklanir:

- Tab acilisinda crash / freeze / beyaz ekran.
- Mesaj, post veya profil ayarlari backendde kalici olmuyor.
- Voice playback hiz secimi kalici degil.
- Block/unblock veya privacy ayarlari tutarsiz.

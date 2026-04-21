# Cadde İstekleri Badge Sorunu - Çözüm

## Sorun
- Profile girdiğinde TabBar'daki badge (rozet) hemen gidiyordu
- Cadde İstekleri butonunda badge gözükmüyordu
- Badge sadece modal açıp kapattıktan sonra gözüküyordu

## Kök Neden
`loadStreetRequests` fonksiyonu her çağrıldığında API'den gelen count'u direkt TabBar badge'ine set ediyordu. Eğer API'den 0 gelirse (veya cache'de 0 varsa), badge otomatik olarak 0'a düşüyordu.

Profile her mount olduğunda (line 1915) `loadStreetRequests({ force: true })` çağrılıyordu ve bu da badge'i güncelleyip bazen 0'a düşürüyordu.

## Çözüm
Badge'i sadece **artırıyoruz, azaltmıyoruz**. Badge'in 0 olması için tek yol: modal açılması (görüldü).

### Değişiklikler

1. **useEffect cache loading** (line ~1206-1220)
   ```typescript
   // Badge'i sadece artırıyoruz, azaltmıyoruz (modal açılmadıkça)
   if (incomingCount > 0) {
     onStreetRequestsCountChangeRef.current?.(incomingCount);
   }
   ```

2. **loadStreetRequests - cache check** (line ~1557-1567)
   ```typescript
   // Badge'i sadece artırıyoruz, azaltmıyoruz (modal açılmadıkça)
   if (incomingCount > 0) {
     onStreetRequestsCountChangeRef.current?.(incomingCount);
   }
   ```

3. **loadStreetRequests - API response** (line ~1608-1612)
   ```typescript
   // TabBar badge'i güncelle - sadece artırıyoruz, azaltmıyoruz (modal açılmadıkça)
   if (incomingCount > 0) {
     onStreetRequestsCountChangeRef.current?.(incomingCount);
   }
   ```

4. **Modal açıldığında** (line 2382) - değişiklik yok, zaten doğru:
   ```typescript
   // TabBar badge'i temizle (modal açıldı, görüldü)
   onStreetRequestsCountChangeRef.current?.(0);
   ```

## Beklenen Davranış

✅ Profile girdiğinde → TabBar badge hemen gözükür (cache'den)
✅ Cadde İstekleri butonunda → Badge gözükür (count gösterir)
✅ Modal açıldığında → TabBar badge 0 olur (görüldü)
✅ Modal kapandığında → TabBar badge 0 kalır, buton badge kalır
✅ Sayfa değiştirip geri gelince → Badge değişmez (kalıcı)
✅ Kullanıcı onayladığında/sildiğinde → Cache güncellenir, badge azalır

## Test Senaryoları

1. **İlk yükleme**: Profile gir → Badge hemen gözükmeli
2. **Sayfa geçişi**: Messages'a git → Profile dön → Badge kalmalı
3. **Modal açma**: Cadde İstekleri'ne bas → TabBar badge 0 olmalı
4. **Modal kapama**: Modal kapat → TabBar badge 0 kalmalı, buton badge kalmalı
5. **Onaylama**: İstek onayla → Badge azalmalı
6. **Silme**: İstek sil → Badge azalmalı

## Dosyalar
- `src/screens/ProfileScreen/ProfileScreen.tsx` (lines 1206-1220, 1557-1567, 1608-1612, 2382)

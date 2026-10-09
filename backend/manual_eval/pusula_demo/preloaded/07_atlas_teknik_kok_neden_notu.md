# Atlas Lojistik — Zaman Aşımı Teknik İnceleme Notu

Tarih: 2026-10-06  
Hazırlayan: Kerem Demir

Varsayım (henüz doğrulanmadı): Trafik yükseldiğinde uygulama bağlantı havuzundaki boşta bağlantılar geri kazanılmıyor olabilir; bu durumda havuz tükenerek sevkiyat API'sini zaman aşımına düşürebilir. Bu bir hipotezdir, kesinleşmiş kök neden değildir.

Sonuç: Temmuz, Ağustos ve Eylül loglarında aynı `pool exhausted` dizisi görülüyor. Bu bulgu hipotezi destekler, ancak tek başına bağlantı sızıntısını veya kesin kök nedeni kanıtlamaz.

Sonuç: Servis yeniden başlatıldığında havuz sıfırlandığı için sorun geçici olarak kayboluyor, ancak yapılandırma veya kod değişmediğinden tekrar ediyor.

Kısıt: Kalıcı çözüm için yük testi, bağlantı havuzu metriği ve staging erişimi gereklidir. Testler tamamlanmadığı için kök neden hâlâ doğrulanmamıştır.

Taahhüt: Kerem düzeltme dalını hazırladı; Ece'nin test senaryosunu çalıştırabilmesi için Operasyonun staging VPN erişimini onaylaması bekleniyor.

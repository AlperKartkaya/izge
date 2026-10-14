# Tarayıcıya özel genel demo

Genel demo, Pusula'nın izinli örnek kaynaklarını okur. Mesajlar, alıntılı yanıtlar,
iş değişiklikleri, otomasyonlar, bildirimlerin okunma durumu, özel konuşmalar ve
eklenen kaynak metinleri ziyaretçi/kişi kimliğine göre bu tarayıcının localStorage
alanında tutulur. Sayfa yenilemek bunları silmez; **Demoyu sıfırla** siler.
Başka ziyaretçilerin veya gerçek şirket kullanıcılarının verileri değişmez.
Normal kullanıcıların API/persistans akışı değişmedi.

İzge yanıtları statik örnek değildir: `/api/demo/ask/events` mevcut model sağlayıcısını
kullanır. İşlem, en fazla 64 MiB veritabanının RAM kopyasında, aynı kaynak izinleri
ve en fazla iki eşzamanlı çalışma ile yürütülür; sonuç tarayıcıya döner, kopya
kapatılır. Oturum ve kötüye kullanım kotası sunucuda kalır. Yapay zekâ sağlayıcısına
seçili istem/bağlam gönderilir; bu özellik tamamen çevrimdışı çalışmaz.

Demo geçmişine eklenen iki **örnek** İzge konuşması mevcut kaynaklara dayanır:
- Atlas ek iş: 18 saat × 2.000 TL = 36.000 TL + KDV; fatura/teslim kontrolü.
- Atlas tekrar eden zaman aşımı: havuz hipotezi kesin kök neden değildir;
  yük testi ve staging erişimi beklenir.

Bu iki akışın otomasyonları ve bağlantılı bildirimleri ilk açılışta tarayıcıda
hazırlanır. Yeni bir ortak seed/reset veya canlı veritabanı temizliği gerekmez.

## Bilinçli sınırlar

- Otomasyon planı saklanır ama tarayıcı kapalıyken iş çalıştırılmaz. Demoda
  **Hemen çalıştır** ile gerçek yanıt denenir; arka plan zamanlayıcısı taklit edilmez.
- Yerel kaynaklar: dosya başına 2 MB, metin başına 50.000 karakter, en fazla dört
  kaynak ve toplam 100.000 karakter. PDF/TXT/Markdown metni geçici olarak çıkarılır;
  orijinal dosya şirket deposuna yüklenmez, demo önizlemesi çıkarılan metindir.
- Kaynaklar ve mesajlar tarayıcı depolaması temizlenirse kaybolur. Depolama doluysa
  kullanıcıya hata gösterilir; yazma isteği ortak API'ye geri düşmez.
- Yapay zekâ işi kabul edilir edilmez sohbet/otomasyon açılır. Gerçek SSE aşamaları
  ve metin parçaları tarayıcıya işlenir; sayfalar arasında uygulama içi gezinme işi
  durdurmaz. Normal hesapların SSE akışı korunur. Harici araçlar ve ikinci model
  incelemesi demoda kapalıdır.
- shortcut: Devam eden demo isteği açık sekmede çalışır; tam sayfa yenileme veya
  sekmeyi kapatma akışı keser. Sekmeler kapalıyken devam gerekirse sunucuda
  ziyaretçiye özel kalıcı çalışma kuyruğuna geçilmelidir.

## Tekrar doğrulama

1. İki ayrı tarayıcı profiliyle Kerem demosuna girin.
2. İlkinde mesaj/alıntılı yanıt gönderin, bir işi değiştirin, otomasyon ve not ekleyin.
3. Yenileyince ilk tarayıcıda kalmalı; ikinci profilde görünmemeli.
4. Bir ekip konuşmasında `@izge` ile kaynaklı soru sorun; cevap ve kaynak açılmalı.
5. Backend testleri `test_demo_isolation.py`, kaynak DB'sinin başarı ve hata
   sonrasında değişmediğini, kaynak izinlerini ve yerel kaynak referanslarını sınar.
6. Frontend `browserDemo.test.mjs`, desteklenmeyen yazmanın kapalı kaldığını,
   depolama hatasını, alıntıyı, yenileme/ziyaretçi izolasyonunu ve yerel CRUD'u sınar.

Editör, renkli metin katmanını textarea üzerine bindirmek yerine doğal textarea
kullanır. Bu sayede font/padding farkı imleci kaydırmaz. Gönderilmiş `@izge`
ifadelerinin vurgusu ve klavye ile mention tamamlama korunur.

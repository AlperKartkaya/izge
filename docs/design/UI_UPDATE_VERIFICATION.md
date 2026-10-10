# UI güncellemesi — 9 Ekim 2026

## Teslim edilenler

- Dört 3×3 sheet, 36 şeffaf PNG ikon; sırası ve işlevleri [ikon promptu](icons/ICON_GENERATOR_PROMPT.md) ve `icons/manifest.json` içinde. Orijinaller saklanır. `python3 scripts/crop-button-icons.py` çıktıları yeniden üretir; mevcut ImageMagick gerektirir.
- Follow-up yalnızca mesaj taslağını doldurur: `@izge soru? `; boşluktan sonra imleç ve odak. Mention seçimi de tamamlanmış `@izge ` ekler.
- Ekip sohbeti dosya seçicisi: tek sohbet eki, uygulama içi önizleme, sohbet kapsamına bağlı hafıza/retrieval. Özel konuşma ekleri katılımcı olmayan yöneticilere açılmaz. Desteklenen mevcut biçimler: TXT, MD, PDF.
- İş durumu açık → devam ediyor → tamamlandı → açık; hızlı çift tıklama aynı anda ikinci güncelleme göndermez.
- Türkçe varsayılan, kalıcı Türkçe/English seçimi; eski yönetici sayfalarının arayüz metinleri de iki dilde. Yeni agent yanıtları ve follow-up'lar seçilen dilde; otomasyonun dili oluştururken saklanır. Şirket verileri, kaynaklar ve eski sohbetler otomatik çevrilmez.
- Kaynak indeksi yanlış olan model yanıtında bir gerçek yerel-model düzeltme denemesi; hâlâ doğrulanamayan yanıt tamamlandı sayılmaz. Follow-up bağlamı yanıtın atıf yaptığı kaynaklarla sınırlanır.

## Doğrulama

- Frontend: 19 test, ESLint ve TypeScript/Vite build geçti.
- Backend: 66 test geçti; değişen backend dosyalarında Pyright 0 hata/0 uyarı.
- Ayrı veri kopyasında gerçek tarayıcı: mention/caret, follow-up taslağı, dosya yükleme/önizleme, özel ek erişimi, üçlü iş durumu, 41 dil/sayfa kontrolü.
- Gerçek yerel Ollama ile Türkçe ve İngilizce yanıtlar: yüklenen sohbet ekindeki 7 saatlik talep ve henüz alınmamış müşteri onayı, doğru dosya atfı ve ilgili follow-up'larla doğrulandı. Bu, modelin her soruda hatasız olduğunu kanıtlamaz.
- Yerel Coolify dağıtımı: backend, colleague worker, frontend ve website güncel image ile healthy; ürün 8080, website 8081, Coolify 8000 HTTP 200.
- Canlı dağıtımda tekrar mention/follow-up imleci, sayfa sabitliği, ikonlar ve TR/EN toggle kontrol edildi. Test mesajı/dosyası canlı demoya eklenmedi.
- Dağıtım öncesi çevrimiçi SQLite yedeği: `backups/pre-ui-update-final-20261009/data.tar.gz`. Dağıtım sonrası mevcut kaynak, kullanıcı, iş ve otomasyon kayıtları yedekle aynı; yeni şema `f0d5c3b9e024`. Website içeriği değişmedi.

## Sınırlar

Yerel dağıtım: bilgisayar, Docker ve Ollama açık kalmalıdır; dış internet/TLS yayını değildir. Şirket kayıtları ve teknik backend verileri dil seçimiyle yeniden yazılmaz. Geçici QA ortamı kaldırılır; yedekler ve özel doğrulama kayıtları korunur. Commit/push yapılmadı.

## Sol menü ve otomasyon güncellemesi — 9 Ekim 2026, ikinci tur

- Sol menü varsayılan 72px ikon rayı; üstteki İZ düğmesiyle 256px etiketli menüye açılır. Dar mobil ekranda geniş menü içerik üzerine açılır. Yönetici bağlantıları kendi panelinde kayar; sohbet sayfasının tamamı kaymaz.
- İkonlarda görünmez alfa gürültüsü kırpımı küçültüyordu. 36 PNG alfa kanalından %1 fuzz ile yeniden kırpıldı, 232px glif 256px tuvale ortalandı; script merkez sınırlarını doğrular. Yaygın ikon-only kontrollerde 24px glif/44px hedef ve ortalanmış yerleşim kullanılır. Ana eylem niteliğindeki Hemen çalıştır/Durdur yazıları korunur.
- Bildirimler ve kaynak önizlemesi aynı güvenli React Markdown alt kümesini kullanır: kalın metin, başlık, liste, tablo, alıntı ve kod blokları. HTML çalıştırılmaz. Önizleme artık 960px'e kadar geniş ve ekran yüksekliğinin %85'i; kopyala/kapat ikonları aynı başlıktadır. Kopyalama kaynak metnini olduğu gibi alır; izin engelinde modal içi platform fallback kullanır. PDF kopyası erişim kontrollü çıkarılan tam metinden gelir, 500 karakterlik eski özetten değil.
- Çalışan ana sayfası İstanbul saatine ve oturumdaki çalışanın adına göre Günaydın/İyi günler/İyi akşamlar gösterir.
- Otomasyonlar aktif oluşturulur: her saat, 6 saatte bir, her gün, her hafta; İstanbul başlangıç tarihi/saati seçilir. Aktif/Durduruldu durumu, kalan süre, hemen çalıştır, devam ettir, iki tıklamalı silme ve son çalışma çıktısına bağlantı vardır. 30 saniyelik yenileme arka plandaki çalışmaların metadata'sını da günceller.
- Ayrı zamanlama checkpoint'i sayesinde manuel çalışma sıradaki periyodu tüketmez. Geçmiş periyotlar topluca tetiklenmez; en son kaçırılmış periyot bir defa alınır. Son çalışma zamanı gerçek run `started_at`, kuyruk zamanı değildir; Sırada/Devam ediyor/Tamamlandı/Başarısız açıkça gösterilir. Başka çalışanın aynı thread adıyla yazdığı kayıt son çalışma olarak gösterilemez.

### Yeni doğrulama

- Frontend 28/28, backend 71/71 test geçti; ESLint, TypeScript/Vite ve değişen backend dosyalarında Pyright 0 hata/0 uyarı. Mevcut bundle >500KB ve `utcnow` uyarıları bu kapsamda değişmedi.
- 1280×720 çalışan/yönetici, 390×844 mobil, sol menü genişletme ve Team Chat sabit viewport gerçek tarayıcıda doğrulandı. Yönetici menüsündeki 15 bağlantı ve alt kontroller erişilebilir.
- Kaynak modalında tablo ve başlık biçimlendirmesi, kopyala/kapat glif merkezleri (dx=dy=0), tam 684 karakterlik kaynağı kopyalayıp gönderilmemiş taslağa yapıştırma doğrulandı. Bildirimlerde 35 kalın metin düğümü vardı; görünür `**` işareti kalmadı.
- Ayrı QA veri kopyasında yeni saatlik otomasyon, manuel tetikleme olmadan zamanlayıcı tarafından çalıştırıldı ve gerçek yerel Ollama kaynaklı yanıt üretti. Durdur/Devam ettir periyodu korudu. Durdurulmuş otomasyon Hemen çalıştır ile gerçek ikinci yanıt üretti; son çıktı bağlantısı açıldı. Haftalık ileri tarihli otomasyon arayüzden aktif oluşturuldu ve iki aşamalı silindi.
- Kod incelemesindeki iki bulgu (son run sahipliği, sohbet başlık ikonu hizası) regresyon testleri/yerleşim düzeltmesiyle kapatıldı.
- Dağıtım öncesi yeni çevrimiçi SQLite/storage yedeği: `backups/pre-layout-update-final-20261009/data.tar.gz`. Yeni şema: `aa3e6b192d41`.

Sınır: Durdur, gelecekteki zamanlanmış çalışmaları engeller; zaten sıraya alınmış veya çalışmakta olan işi iptal etmez. Otomasyon tarihleri İstanbul saatindedir. Kaynak metni kopyalanır, biçimlendirilmiş HTML kopyalanmaz. Website içeriği ve mevcut demo kayıtları değiştirilmez; QA kaynakları canlı ürün verisine eklenmez.

Canlı son kontrol: dört Coolify container güncel image ile healthy, 8080/8081/8000 HTTP 200; şema `aa3e6b192d41`. Yedekle karşılaştırmada 10 kaynak, 8 kullanıcı, 4 iş ve 4 otomasyonun eski alanları birebir korundu. Website index hash'i değişmedi. Canlı arayüzde 72/256px menü, 44px gönder/24px glif, merkez dx=dy=0, sabit sohbet viewport'u, 35 biçimlendirilmiş bold düğümü ve TR/EN selamlama doğrulandı. Geçici QA container/network/volume kaldırıldı; yedek ve özel doğrulama kayıtları korundu.

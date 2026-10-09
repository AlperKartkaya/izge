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

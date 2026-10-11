# Yerel Türkçe İzge demosu

Bu Mac'te kurulu çalışan ortam:

| Uygulama | Adres |
|---|---|
| İzge | http://localhost:8080 |
| Mevcut website | http://localhost:8081 |
| Coolify | http://localhost:8000 |

Website kaynakları değiştirilmez. Uygulama ve website gerçek Coolify servisidir;
Ollama Mac'te çalışır, container'lar `host.docker.internal:11434` üzerinden
kurulu `qwen3.5:9b` modelini kullanır. Ücretli sunucu/domain kurulmadı.

## Sunum

Güncel sunum şirketi **Pusula Yazılım ve IT Danışmanlık**. Altı senaryonun
sırası, beklenen bulguları ve canlı sorular [DEMO_FLOW.md](DEMO_FLOW.md)
dosyasında. Deniz hesabı `deniz@pusula.demo`, Ece hesabı `ece@pusula.demo`;
önceki Deniz/Ece parolaları korunmuştur.

Başlangıçta 10 kaynak, 26 çalışan mesajı, 4 iş, 3 günlük otomasyon ve gerçek
yerel modelin mesai başlamadan ürettiği okunmamış talep bildirimi bulunur.
`docs/demo/live-upload/koru-ihale-zeyilname-2.md` **önceden yüklenmez**;
sunum sırasında Hafıza'dan yüklenerek eksik ihale belgesi bildirimi tetiklenir.
Prova için kullanılan ayrı veritabanı ve canlı yükleme kayıtları sunuma taşınmaz.

Çalışan hesapları ve parolaları yalnız bu makinedeki
`~/.local/share/izge/demo-credentials.json` dosyasındadır. Parolaları repoya
veya ekran görüntüsüne koymayın. Çalışan hesabıyla giriş yapın:

1. **Hafıza:** Türkçe karar dosyası veya toplantı notu ekleyin, kaynağı açın.
2. **İzge:** Yeni eklediğiniz kaynak hakkında sorun; gerçek yanıt akışını ve
   kaynak alıntısını gösterin. Bilgi yoksa İzge'nin bunu söylemesini bekleyin.
3. **Team Chat:** İş arkadaşınıza mesaj gönderin veya grup oluşturun;
   `@izge` ile agent'i çağırın. Yanıt aynı konuşmada teslim edilir.
4. **İşlerim:** İş ve hatırlatma oluşturun, günlük çalışma notu ekleyin.
5. **Ana sayfa → Şimdi değerlendir:** Aynı gerçek gün sonu işini başlatın;
   riskleri, kaynaklarını ve yarın için önerileri gösterin.

Türkçe varsayılandır; dil menüsünden İngilizceye geçilebilir.
Bu sürüm genel dosya düzenleme, Jira entegrasyonu veya dış sistemlerde
otonom işlem yapmaz; agent şirket kaynaklarından yanıt ve öneri üretir.

## Çalıştırma ve güncelleme

Docker Desktop ve Ollama açık olmalıdır. Kurulu ortamı, verileri silmeden
yeniden build/deploy etmek için repo kökünden `scripts/local-demo.sh` çalışır.
Script yalnız bu İzge Coolify servisini yeniden deploy eder. Coolify'da
eşzamanlı ikinci bir deploy başlatmayın. Worker bir replica'dır.

Coolify yönetim ayarları ve gizli dosyalar `~/.local/share/izge/coolify/`
altında, yönetici hesabı `.env` içindedir; dosyalar repoya dahil değildir.
API token'ı süreli olduğundan süresi dolduğunda Coolify'dan yenilenmelidir.
Yönetim servisi: `deploy/coolify-local.compose.yml`.
Ürün servisi: `deploy/izge-local.compose.yml`.

Gün sonu işi her gün İstanbul saatiyle 17:00 sonrasında bir kez çalışır.
Tarayıcının açık olması gerekmez; **Mac uyursa/kapanırsa veya Docker/Ollama
durursa çalışamaz**. Bu yerel demo internetten erişilen 7/24 üretim sunucusu
değildir. Tüm yayın portları yalnız `127.0.0.1`'e bağlıdır; dış yayın ve TLS
bu kurulumun kapsamı dışındadır. Taşınan eski demo hesaplarının şifreleri
korunmuştur; internete açmadan önce değiştirilmelidir.

## Veri ve yedek

- Orijinal `backend/data/` silinmedi ve taşınan kopyanın migration'ları burada
  çalıştırılmadı.
- Kurulum öncesi SQLite online backup + dosyalar `backups/before-coolify-*`
  altında. Container'daki dosya yolları yalnız import kopyasında `/data`'ya
  dönüştürüldü.
- Aktif veri `izge-product-data` external Docker volume'ündedir; redeploy'da
  volume silinmez. **Docker volume prune/down -v kullanmayın.**
- Coolify instance verisinin yedeği ürün SQLite/dosyalarının yerine geçmez.
  Ürün yedeğinde SQLite online backup API'siyle DB ve storage/pasted dosyaları
  birlikte alınmalıdır; çalışan DB'yi yalnız `cp` ile kopyalamayın.

Coolify Docker Desktop uyarlaması upstream
`coollabsio/coolify@3b33e8a4ab753308dde26282ebe057e578d561d2`
Docker Desktop compose ve testing-host Dockerfile temelindedir. Yönetim image
digest'i compose'ta sabittir. Testing-host'un upstream ortak SSH anahtarı
yerine kurulumda bu makineye özel anahtar üretildi. Docker socket erişimi
yalnız yerel Coolify yönetim container'larına verilir, ürün/LLM agent'ine değil.

## Doğrulama

```sh
cd backend
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m manual_eval.run_isolated_seed_eval
.venv/bin/python -m manual_eval.run_isolated_synthetic_company_workflow
# Pusula canlı dosya testini yalnız ayrı bir QA kopyasında çalıştırın:
IZGE_DEMO_QA_BASE_URL=http://127.0.0.1:18080 \
IZGE_DEMO_QA_CREDENTIALS_PATH="$HOME/.local/share/izge/pusula-qa-credentials.json" \
  .venv/bin/python -m manual_eval.run_pusula_demo_smoke
```

Frontend için `cd frontend && npm test && npm run lint && npm run build` çalışır
(bu makinede Node 24 ile doğrulandı).

Otomatik test/build geçmesi gerçek modelin veya deployment'ın çalıştığını
tek başına kanıtlamaz; gerçek HTTP/Ollama smoke raporu ayrıca tutulur.

### İlk MVP provasında doğrulananlar — önceki veri seti, 9 Ekim 2026

- 27 backend testi; 308 izole kaynak/izin kontrolü ve 67 şirket iş akışı
  kontrolü geçti. Frontend lint, build ve Türkçe saat regresyon testi geçti.
- Gerçek `qwen3.5:9b` ile yeni (eski yanıtı tekrar oynatmayan) SSE soru/yanıt,
  açılabilir alıntı, iki çalışan arasında grup görünürlüğü, özel mesaj sınırı,
  tek seferlik hatırlatma ve manuel gün sonu hafıza/KG güncellemesi doğrulandı.
  Rapor: `~/.local/share/izge/turkish-colleague-smoke-report.json`.
- Tarayıcıdan Deniz hesabıyla kaynak ve günlük not eklendi, kaynak ilk MVP doğrulamasında ayrı
  sekmede açıldı (aşağıdaki arayüz güncellemesinde uygulama içi önizlemeye geçti); Ece hesabıyla karşılıklı mesajlaşıldı. Gerçek günlük gözlem
  daha önceki kapasite varsayımı için kaynaklı değişiklik uyarısı üretti.
- İki ayrı tarayıcı oturumunda `@İzge` çağrısının gerçek düşünme/streaming
  durumları ve aynı grup yanıtının Ece’ye ulaşması doğrulandı. Grup işi
  çalışırken başka konuşmanın mesaj alanı kullanılabilir kaldı. İstanbul
  saatli görev formu, tek reminder ve tamamlandı/yeniden aç geçişi doğrulandı.
- Kaynak bulunmayan soruda model Türkçe olarak bilgisinin olmadığını söyledi,
  kaynak listesi boş kaldı. Desteklenmeyen dosya Türkçe hata ile reddedildi,
  kaynak kaydı oluşturulmadı.
- Ürün yeniden deploy edildi; önceki ve yeni kayıtlar korundu. Ayrı geçici
  volume'e restore provasında 34 tablo ve 37 dosyanın sayıları/hash'leri ve
  kaynak yolları doğrulandı. Yedek yolu:
  `~/.local/share/izge/last-restore-drill-path`.
- Website kaynaklarında değişiklik yok; sunulan index dosyası kaynakla
  aynı SHA-256 değerine sahip.

Sınırlar: çok kullanıcılı yük/uzun süreli 7/24 testi yapılmadı. Değişen hedef
backend dosyalarının tip kontrolü temiz; tüm backend tip kontrolünde kapsam
öncesinden kalan 29 hata var. İngilizce çeviri ve Jira bağlantısı yok.
İzge'nin değişiklik uyarıları ve önerileri kaynaklarıyla insan tarafından
incelenmelidir; model yanıtı şirket adına kesin karar değildir.


### Sohbet ve kaynak arayüzü güncellemesi — 9 Ekim 2026

- beautiful-ui 07 Chat / 08 Prompt Bar / 10 Context Cards, örnek yanıtlar
  yerine gerçek konuşma, değerlendirme ve kaynak kayıtlarıyla uyarlandı.
- İzge ve Team Chat masaüstünde 1440×1000, mobilde 390×844 görünümde
  belgenin boyunu aşmıyor. Mesajlar ve kişi listesi ayrı kayıyor; prompt
  çubuğu görünür kalıyor. Geçmiş okurken dört saniyelik polling konumu
  değiştirmiyor; gecikmiş eski yanıt yeni gönderilen gerçek mesajı silmiyor.
- Gönderim hatası başarılı polling ile kaybolmuyor. İlk geçmiş yüklemesi ve
  gönderim sürerken ikinci soru gönderilemiyor. Enter gönderiyor,
  Shift+Enter yeni satır ekliyor. Açık/koyu tema renkleri mevcut token'lardan.
- Hafıza kaynak listesi sınırlı yükseklikte kayıyor. Kaynaklar yeni sekme
  açmadan ortalanmış 620×440px dialog'da açılıyor; X/Escape ile kapanıyor.
  Metin güvenli biçimde gösteriliyor, klavye odağı tetikleyiciye dönüyor.
- PDF destekleyen tarayıcılar yetkili blob'u görüntüler. Yerel PDF
  görüntüleyicisi olmayan tarayıcılarda boş pencere yerine açıkça belirtilen
  ilk 500 karakterlik metin önizlemesi ve indirme bağlantısı gösterilir.
- Bu değişiklikte 4 frontend testi, lint ve TypeScript/build; 27 backend
  regresyon testi geçti. Canlı tarayıcı kontrollerinde kaynaklı gerçek
  Ollama yanıtı, günlük değerlendirme kartları, metin önizleme ve kaydırma
  davranışı doğrulandı. Ağ hatası/gecikme senaryoları kontrollü tarayıcı
  enstrümantasyonuyla, model yanıtı ise gerçek yerel modelle denendi.
- Bu turda 28 canlı/kontrollü tarayıcı kontrolü geçti; son deploy üzerinde
  masaüstü/mobil geometri, polling ve desteksiz PDF metin alternatifi tekrar doğrulandı.
- Arayüz kontrol raporu: `~/.local/share/izge/ui-layout-checks.json`.

Sınır: bu kontrol tarayıcısında yerel PDF görüntüleyicisi yoktur; native PDF
sayfa çizimi burada doğrulanamadı. Desteksiz tarayıcılar için metin/indirme
alternatifi bulunur. Website kaynakları ve backend iş davranışı değiştirilmedi.

### Güncel Pusula sunum doğrulaması — 9 Ekim 2026

- 53 backend ve 9 frontend regresyon testi geçti; frontend ESLint,
  TypeScript/build ve değişen servis/router hedeflerinin Pyright kontrolü temiz.
  Eski Türkçe test yardımcılarının tip uyarıları ve kapsam öncesi tüm-backend
  tip borcu bu sonuçtan ayrı tutulur.
- Ayrı QA kopyasında gerçek `qwen3.5:9b` ile altı senaryo, kaynaklar/takip
  soruları, canlı zeyilname bildirimi, bildirimin konuşmada sürdürülmesi ve
  ilgisiz dosyada bildirim üretilmemesi dahil 11 kontrol geçti.
  Rapor: `~/.local/share/izge/pusula-demo-smoke-report.json`.
- Gerçek Team Chat `@izge` yanıtı aynı grupta göründü; çalışan mesajı ve
  agent yanıtı diğer katılımcıya bildirim gönderdi. Takip sorusu gönderilmeden
  `@izge` taslağına yerleşti. Otomasyon oluşturma, duraklatma/kalıcılık ve
  gerçek modelle manuel çalıştırma ayrıca kontrol edildi.
- Son incelemede ay/generic kelime ve aynı Türkçe kelimenin çekim tekrarından
  doğan yanlış kaynak ilişkileri düzeltildi. Mevcut 10 kaynağın türetilmiş
  hafıza/sinyalleri yeniden hesaplandı; kaynak kimlikleri, çalışan mesajları
  ve gerçek **07:26** okunmamış başlangıç bildirimi korunmuştur.
- Son image ile gerçek günlük değerlendirme, bağlantı havuzunu kesin neden
  değil doğrulanmamış hipotez olarak anlattı; kaynaklar, takip soruları ve yeni
  okunmamış bildirim üretildi. Canlı KVKK zeyilnamesi hâlâ yüklenmemiştir.
  Rapor: `~/.local/share/izge/pusula-presentation-review-report.json`.
- Coolify yayını sonrası backend, colleague, frontend ve website container'ları
  doğru image ile healthy; üç yerel HTTP adresi 200 döndü. Website kaynakları
  değişmedi ve sunulan index'in SHA-256 değeri kaynak dosyayla eşleşti.

- Son model provasında onay bekleyen 36.000 TL’nin özet içinde kesinleşmiş
  alacak diye etiketlenmesi reddedildi; yanıt talimatı ve gerçek-LLM test
  koşulu güçlendirildi. Son image ile yeni yanıt, 18 saat × 2.000 TL
  potansiyel ücret/onay ayrımını ve doğrulanmamış kök neden ayrımını korudu.
  Kaynaklar ve takip soruları üretildi; bu prova sunuma mesaj eklemedi.
  Rapor: `~/.local/share/izge/pusula-final-source-model-report.json`.
- Son tarayıcı turunda 10 kontrol daha geçti: masaüstü/mobil sabit sohbet
  sayfası, seçilen `@izge` vurgusu, polling sırasında okuma konumunun korunması,
  gerçek günlük kartları/kalın metin/kaynak çipleri, ortalanmış kaynak önizlemesi
  ve Hafıza kaynak listesinin ayrı kayması. Mesaj gönderilmedi, başlangıç
  bildirimleri okunmadı. Rapor: `~/.local/share/izge/pusula-delivery-ui-checks.json`.

Yedek konumu: `~/.local/share/izge/pusula-final-derived-backup-path`.
Bunlar kaynaklı demo/MVP kanıtıdır; hatasız LLM, 40 sayfalık her şartnamenin
eksiksiz taranması, yüksek eşzamanlı yük veya kesintisiz 7/24 sunucu garantisi değildir.

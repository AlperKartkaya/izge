# İzge demo akışı — Pusula Yazılım ve IT Danışmanlık

## Demo hikâyesi

Pusula, B2B yazılım geliştirme ve IT danışmanlığı veren altı kişilik bir ekip. İzge; sözleşme, fatura, müşteri yazışması, destek kaydı, günlük çalışma notu, görev ve ekip konuşmalarını birlikte okuyarak tek tek ekiplerin gözünden kaçan işleri görünür kılar.

Demo tek bir “sihirli dosya” üzerine kurulmaz. Altı gerçek iş problemini sırayla gösterir; yalnızca 4. senaryo canlı dosya yüklemeyle tetiklenir. Böylece önceden bulunan mesai öncesi değerlendirmeler ile anlık değerlendirme birbirinden ayrılır.

## Önceden sistemde bulunacak veri

| # | Problem | Önceden bulunan kaynaklar | Demoda gösterilecek sonuç |
|---|---|---|---|
| 1 | Faturalanmamış işler | Atlas sözleşmesi, Eylül faturası, teslim kaydı, Deniz ve Kerem’in günlükleri | Müşteri teyidiyle faturalandırılabilecek **18 saat × 2.000 TL = 36.000 TL** potansiyel ek ücret görünür olur. |
| 2 | Unutulan müşteri talebi | Atlas müşteri yazışması, görev/ticket dökümü ve ekip konuşması | “Sevkiyatları Excel’e aktar” talebine “hallederiz” denmiş; fakat sahibi ve ticket’ı yoktur. Bu, demo başında okunmamış mesai öncesi bildirimi olarak bulunur. |
| 3 | Kaybedilmek üzere olan müşteri | Üç aya yayılan Atlas destek geçmişi, müşteri başarı notu ve destek konuşması | Aynı zaman aşımı şikâyeti farklı çalışanlara gelmiş; müşteri yenilemeyi sorgulamaktadır. |
| 4 | Eksik teklif/ihale belgesi | Koru ana şartnamesi ve mevcut teklif paketi kontrol listesi | Canlı yüklenecek zeyilname, imzalı KVKK taahhütnamesini zorunlu kılar. İzge mevcut paketle karşılaştırıp eksik belgeyi bildirir. |
| 5 | Tekrarlayan problem | Atlas Temmuz, Ağustos ve Eylül olay kayıtları ile teknik inceleme notu | Her ay servis yeniden başlatılmış; bağlantı havuzu hipotezi henüz test edilip doğrulanmamıştır. |
| 6 | Ekipler arası bekleyen iş | Ece’nin teslim notu, açık staging erişim işi ve iki ayrı ekip konuşması | Ece Operasyon onayı beklerken Mert kendisinden onay beklendiğini bilmiyordur. İzge aktarılacak işi hazırlar. |

Problemlerin kanıtı dosyalarda ve konuşmalarda dağınık tutulur. Açık görevler yalnızca gerçekten kayıt altına alınmış işleri temsil eder; unutulan Excel aktarım talebi için bilerek görev oluşturulmaz.

## Canlı yükleme için ayrılan dosyalar

Bu dosyalar seed işlemine **dahil edilmez** ve İzge demodan önce bunları görmez:

1. `docs/demo/live-upload/koru-ihale-zeyilname-2.md` — 4. senaryoyu canlı tetikler; son başvuru paketine imzalı KVKK taahhütnamesi ekler.
2. `docs/demo/live-upload/atlas-ek-is-talebi-ticari-degisiklik.md` — isteğe bağlı ikinci canlı prova; yeni işi “mevcut bakım paketine dahil” sayan müşteri mesajı, sözleşmedeki saatlik ek ücret koşuluyla karşılaştırılır.

Ana sunumda yalnızca ilk dosya yüklenir. İkinci dosya, canlı LLM yanıtı beklenmedik biçimde zayıf kalırsa veya ek soru gelirse kullanılacak yedek akıştır.

## Sunumda dikkat edilecekler

- 36.000 TL kesinleşmiş alacak değil, müşteri teyidi ve ticari onay bekleyen fırsattır.
- Bağlantı havuzu sorunu henüz doğrulanmamış kök neden hipotezidir; kalıcı çözüm yapılmış gibi anlatılmaz.
- Takip sorusuna tıklamak mesaj göndermez; `@izge` ile mesaj kutusuna yerleştirir, çalışan düzenleyip gönderir.
- Mailbox bağlantısı ve Jira entegrasyonu bu sürümde yoktur. Günlük otomasyonlar, yüklenmiş şirket kayıtlarını ve açık işleri kullanır.
- Yerel bilgisayar ve Ollama açık kaldığı sürece zamanlanmış değerlendirmeler çalışır; bilgisayar uyuyunca 7/24 çalışma garantisi yoktur.

## Sunum sırası

1. **Bildirimler:** Deniz sabah işe başlar. İzge’nin mesai dışında fark ettiği, okunmamış “Atlas’ın Excel aktarım talebi kayıtsız kaldı” bildirimini açar.
2. **İzge ile devam:** Bildirime tıklanınca aynı bulgu İzge konuşmasının ilk mesajıdır. “Kim üstlenebilir ve bugün ne yapmalıyız?” diye sorulur; kaynaklar müşteri yazışması ve ticket dökümüdür.
3. **Gelir kaçağı:** “Atlas için faturalanmamış iş var mı?” sorulur. İzge sözleşme, günlükler, teslim ve faturayı birleştirip 36.000 TL fırsatı gösterir.
4. **Müşteri riski ve tekrar eden arıza:** “Atlas neden riskte?” sorulur. Üç aylık zaman aşımı geçmişi, tekrar başlatmalar ve doğrulanmayı bekleyen connection pool hipotezi birlikte gösterilir.
5. **Canlı dosya yükleme:** Hafıza sayfasından Koru zeyilnamesi yüklenir. Yükleme değerlendirmesi bildirim üretir: imzalı KVKK taahhütnamesi pakette yoktur. Bildirimden İzge konuşmasına geçilip sorumlu/son tarih sorulur.
6. **Ekipler arası bekleme:** Team Chat’te Ece’nin “staging erişimi bekliyorum” konuşması ve hafızadaki staging devir notunda Operasyon tarafının “bize talep gelmedi” kaydı gösterilir. İzge’den Mert’e aktarılacak net işi hazırlaması istenir. Deniz’in katılımcı olmadığı özel Operasyon sohbeti ona açılmaz.
7. **Kapanış:** İzge’nin yalnızca cevap vermediği; mesai dışı tarama, canlı değişiklik kontrolü, kaynaklı açıklama ve görev takibi yaptığı özetlenir.

## Canlı sorgular

- `Atlas için faturalanmamış veya faturaya eklenmesi gereken iş var mı? Tutarı kaynaklarıyla hesapla.`
- `Atlas müşterisini kaybetme riski var mı? Tekrarlayan problemleri ve geçici müdahaleleri birleştir.`
- `Koru teklif paketinde yeni zeyilnameye göre eksik olan zorunlu belge ne? Sorumlusunu ve son tarihi öner.`
- `Ece'nin beklediği staging erişimi neden ilerlemiyor? Mert'e iletilecek kısa işi hazırla.`

## Seed ve güvenlik sınırı

Seed komutu aktif veritabanını sessizce değiştirmez. Hedef veritabanı ve depolama yolları açıkça verilmeli, mevcut hedefi değiştirmek için `--replace` kullanılmalıdır. `--replace`, önce veritabanı ile dosya depolarını zaman damgalı bir yedeğe kopyalar. Kullanıcı parolaları terminale yazılmaz; yalnızca izinleri kısıtlanmış credentials dosyasına kaydedilir.

Gerçek LLM tarafından üretilmiş başlangıç bildirimi, LLM çalıştırılmadan taklit edilmez. `--run-baseline-detection` seçeneği #2 için gerçek değerlendirmeyi seed sırasında çalıştırır ve sonucunu okunmamış başlangıç bildirimi olarak bağlar.

Fixture içeriğini veritabanına dokunmadan kontrol etme:

```bash
cd backend
.venv/bin/python -m manual_eval.seed_pusula_demo --check-only
```

Yeni ve boş bir yerel hedef oluşturma:

```bash
cd backend
IZGE_LOCAL_LLM_ENABLED=true \
IZGE_LOCAL_LLM_MODEL=qwen3.5:9b \
IZGE_LOCAL_LLM_BASE_URL=http://127.0.0.1:11434 \
.venv/bin/python -m manual_eval.seed_pusula_demo \
  --database /tmp/pusula-demo/izge.db \
  --storage-root /tmp/pusula-demo/storage \
  --pasted-root /tmp/pusula-demo/pasted \
  --credentials-file ~/.local/share/izge/demo-credentials.json \
  --run-baseline-detection
```

Mevcut yerel demo hedefini değiştirmek için aynı komuta `--replace --backup-dir <güvenli-yedek-dizini>` eklenir. Hedef doluyken bu iki seçenek olmadan işlem reddedilir. Credentials dosyası `selin`, `deniz`, `ece`, `mert`, `derya`, `kerem` anahtarlarını ve her biri için `email`/`password` alanlarını içerir; var olan Deniz/Ece parolaları korunur, yeni parolalar yalnız bu `0600` dosyaya yazılır.

Bildirim kararı ve takip soruları ayrı, doğrulanan JSON çıktıları olarak gerçek yerel modelden alınır; serbest metinde bir önek aramaya dayanmaz. Bunun için [Ollama’nın resmi structured outputs yöntemi](https://docs.ollama.com/capabilities/structured-outputs) kullanılır. Takip sorusu üretilemezse ana yanıt korunur; hazır/sahte sorular eklenmez.

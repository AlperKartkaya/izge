# İzge backend: Rust’a taşınabilirlik

**Tarih:** 12 Ekim 2026  
**Kapsam:** Repository ve resmî teknik kaynaklar üzerinden fizibilite. Rust implementasyonu veya benchmark değildir.

## Karar özeti

**Teknik olarak taşınabilir; bugün bütün backend’i yeniden yazmak için ölçülmüş bir gerekçe yok.**
HTTP, SQLite, dosya yükleme, SSE ve model sağlayıcıları için Rust araçları mevcut.
Asıl maliyet framework değiştirmek değil; izin, kanıt, konuşma, iş kuyruğu ve hata
davranışlarını aynı doğrulukta korumak.

Öneri: Python backend’i koru; CPU, bellek, veritabanı kilit beklemesi ve model beklemesini
ayrı ölç. Gerçek darboğaz varsa küçük bir Rust pilotunu karşılaştır.
Bu rapor hızlanma, bellek tasarrufu veya bulut maliyeti düşüşü ölçmemiştir.
Model yanıt kalitesi ve UI kalitesi backend dilinden kendiliğinden iyileşmez.

## 1. Taşınacak sistem

| Alan | Kod kanıtı | Etki |
|---|---|---|
| HTTP ve şema | `backend/app/main.py`, `backend/pyproject.toml`, `backend/app/schemas/` | FastAPI/Pydantic doğrulama, varsayılanlar ve hata JSON’u eşleştirilmeli. |
| Veri erişimi | `backend/app/db.py`, `backend/app/models/` | SQLAlchemy, SQLite WAL ve foreign-key davranışı korunmalı. |
| Migration | `backend/app/migration_tools.py`, `backend/app/schema.py`, `backend/migrations/` | Alembic geçmişi, eski veri onarımı ve FTS5 korunmalı. |
| Gerçek AI worker | `backend/app/colleague_worker.py`, `docker-compose.yml` | Otomasyon, hatırlatma ve AI çalışmalarını bu worker işletiyor. |
| Ayrı stage worker | `backend/app/worker.py` | Sınırlı stage paket doğrulaması; yalnız bunu taşımak gerçek AI iş yükünü taşımaz. |
| Kanıtlı sorgulama | `backend/app/services/querying.py` | ORM sorguları, kanıt seçimi ve model çağrıları aynı servis katmanında birleşiyor. |
| Model protokolleri | `backend/app/services/agent_model.py` | HTTP entegrasyonları taşınabilir; Python model SDK’sına zorunlu bağımlılık yok. |
| Dosya/ingestion | `backend/app/services/storage.py`, `backend/app/services/ingestion.py` | TXT, Markdown ve metni okunabilir PDF; OCR/Word/Excel eklemek göç değildir. |
| Ön yüz sözleşmesi | `frontend/src/lib/api.ts` | Cookie/Bearer, Accept-Language, JSON ve detail hata alanı korunmalı. |
| Kalıcı veri | `backend/Dockerfile`, `backend/app/config.py` | /data/izge.db, kaynak dosyaları ve worker veri sahipliği korunmalı. |

Bu bir “FastAPI yerine Axum” değişikliğinden büyük. Servisler SQLAlchemy Session ve domain
modellerini doğrudan kullanıyor; saf hesaplama ile veri erişimi her yerde ayrılmış değil.

## 2. Rust karşılıkları

Adaylar bu rapor kapsamında kurulmadı veya entegrasyonla doğrulanmadı.

| İhtiyaç | Aday | İzge’ye özel sınır |
|---|---|---|
| HTTP, async, SSE | Axum + Tokio | Keep-alive mevcut; event sırası ve yeniden yetkilendirme uygulamanın sorumluluğu. |
| SQLite | SQLx | WAL, foreign keys ve busy timeout açıkça yapılandırılmalı. |
| JSON | Serde | Pydantic doğrulama/hata biçiminin otomatik eşdeğeri değil. |
| Model/MCP HTTP | reqwest | Redirect/proxy varsayılanları mevcut istemciden farklı olabilir. |
| Python içinde küçük Rust çekirdeği | PyO3 | API/DB/auth Python’da kalır; native paketleme ve iki dil bakım maliyeti eklenir. |
| PDF | pdf-extract gibi adaylar | pypdf ile çıktı eşdeğerliği gerçek belgelerle ölçülmeli. |

Resmî kaynaklar:
[Axum SSE](https://docs.rs/axum/latest/axum/response/sse/index.html),
[SQLx SQLite ayarları](https://docs.rs/sqlx/latest/sqlx/sqlite/struct.SqliteConnectOptions.html),
[Serde](https://serde.rs/),
[reqwest](https://docs.rs/reqwest/latest/reqwest/),
[PyO3](https://pyo3.rs/),
[pdf-extract](https://docs.rs/pdf-extract/latest/pdf_extract/).

Mevcut model istemcisi doğrudan http.client kullanıyor. reqwest yönlendirmeleri izleyebilir ve
sistem proxy ayarlarını kullanabilir; on-premise veri sınırı için bunlar açıkça yapılandırılmalı.
Aynı URL’yi vermek aynı güvenlik davranışı değildir.

Senkron PDF/parola türetme/CPU işlerini async yürütücü üzerinde doğrudan çalıştırmak da doğru
bir port değildir; sınırlı blocking iş düzeni gerekir.
[Tokio senkron kod rehberi](https://tokio.rs/tokio/topics/bridging).

## 3. Kritik eşdeğerlik riskleri

### İzin ve kanıt zinciri
`services/permissions.py`, `services/querying.py`, `routers/work.py`:
- Workspace sınırı ve kaynak görünürlüğü.
- Yönetici rolünün özel sohbet eklerine otomatik erişmemesi.
- Türetilmiş sinyalin destekleyici kaynaklarının da görünür olması.
- Eski cevap okunurken güncel izinlerin yeniden uygulanması.
- SSE sürerken kullanıcı/kaynak izinlerinin yeniden kontrolü.

Yalnız middleware auth kontrolü yeterli değil. Başlık, alıntı, eski cevap ve event üzerinden
sızıntı olabilir. Rust bellek güvenliği domain yetkilendirmesinin yerine geçmez.

### İş kuyruğu, lease ve tekrar deneme
`services/colleague.py`: koşullu UPDATE ile claim, lease sahipliği ve eski worker’ın yazmasını
engelleme korunmalı. İki worker yarışı, işlem ortasında ölüm, lease bitmesi, eski sonucun
gecikerek gelmesi, reset eventi ve tekrar gönderilen istek test edilmeli.
Python ve Rust worker’larını aynı canlı kuyruğa deney amacıyla bağlamak güvenli karşılaştırma değildir.

### SSE sözleşmesi
`routers/work.py`: event ID/sequence, Last-Event-ID, after_sequence, reset sonrası sınır,
terminal kapanış, keep-alive ve buffering davranışı korunmalı. Erken EOF başarı değildir;
retry sırasında token/cevap iki kez gösterilmemeli.
Regresyon başlangıcı: `tests/test_agent_model.py`, `tests/test_colleague.py`.

### SQLite ve migration
WAL aynı anda tek yazıcı sınırını kaldırmaz; Rust bu sınırı çözmez.
[SQLite WAL](https://www.sqlite.org/wal.html).
- FTS5 hedef binary/container üzerinde doğrulanmalı.
- İlk Rust pilotu mevcut Alembic şemasını okumalı, migration sahipliğini almamalı.
- Alembic ve SQLx aynı şemayı bağımsız yönetmemeli.
- SQLite→PostgreSQL ayrı karardır; dil göçüyle aynı anda yapılması riski artırır.
- Kaynak dosyaları, DB yedeği ve gerçek restore/rollback doğrulaması gereklidir.

### Türkçe, PDF ve hash
`services/turkish_text.py` I/İ/ı/i normalizasyonu; `services/ingestion.py` PDF sayfa işaretleri
ve chunk sırası; `services/scenario_support.py` sıralı JSON snapshot hash’i üretir.
Rust’ın Unicode/sayı/tarih serileştirmesi farklıysa aynı mantıksal içerik farklı kanıt kimliği
üretebilir. PDF ayrıştırmasını ilk aşamada Python’da bırakmak daha düşük risklidir.

### Auth, ağ ve dosyalar
`services/security.py`: mevcut PBKDF2-HMAC-SHA256 parola ve hash’lenmiş session biçimi okunmalı.
Parola algoritması değişimi ayrı, geriye uyumlu iş olmalı.
`routers/auth.py`: cookie bayrakları, proxy güven sınırı ve istemci IP’si korunmalı.
Başarısız giriş sayacı süreç içi bellekte; servis çoğaltmak bunu kendiliğinden çözmez.
`services/storage.py`: canonical path yönetilen kökler içinde kalmalı.
`services/agent_tools.py`: MCP çıktısı bütün okuyucuların izin sınırına uymalı.

## 4. Seçenekler ve karar

| Yol | Kazanç | Bedel/risk | Öneri |
|---|---|---|---|
| Python + ölçüm/hedefli iyileştirme | Tek runtime, düşük ürün riski | Olası Rust kaynak avantajı ertelenir | Şimdi |
| Ölçülmüş CPU çekirdeğini PyO3 ile taşı | API/DB/izin sınırı değişmez | FFI/native paketleme | Darboğaz kanıtlanırsa |
| Bir servis dilimini aşamalı taşı | Geri dönüş sınırı seçilebilir | İki servis ve sözleşme koordinasyonu | Operasyonel gerekçe varsa |
| Baştan Rust backend | Uzun vadede tek Rust sistemi | En yüksek eşdeğerlik/teslimat riski | Şu an önerilmez |

Rust ağırlıklı ekip, sıkı bellek bütçesi veya çok fazla eşzamanlı bağlantı hedefi erken göç
lehine gerçek gerekçeler olabilir. Ancak bunlar mevcut İzge yükünde henüz ölçülmüş değil.

## 5. Efor ve aşamalar

**Planlama tahmini; taahhüt veya ölçülmüş teslimat süresi değil.**
Python/Rust deneyimli bir mühendis, kararlı kapsam ve ürün bakımına ayrı zaman varsayılır.
Bir mühendis-hafta beş tam gün; alternatif satırlar toplanmaz.

| İş | Tahmin | Çıkış şartı |
|---|---:|---|
| Ölçüm + dil bağımsız sözleşme fixture’ları | 1–2 mühendis-hafta | Darboğaz ve korunacak davranış kanıtı |
| Tek CPU/hesaplama pilotu | İlave 2–4 mühendis-hafta | Eşdeğer çıktı ve uçtan uca fayda |
| Anlamlı servis dilimi | Toplam 6–12 mühendis-hafta | Auth/veri/test/dağıtım/rollback dahil |
| Kapsamlı backend rewrite | Toplam 16–28+ mühendis-hafta | Tüm domain kabul kapıları |

Zorunlu tam göçte sıra: sözleşme fixture’ları → izole DB kopyasında salt-okunur dilim →
izin/auth eşdeğerliği → basit yazmalar → tek migration/worker sahipliği → AI/lease/otomasyon →
gerçek corpus ile PDF/kanıt eşdeğerliği → geri dönüş denemesi → eski yolu kaldırma.

## 6. Kabul kapıları

Python testleri bilgi kaynağıdır; doğrudan Python fonksiyonlarını çağıran testler Rust’ı
otomatik doğrulamaz. Browser gerektirmeyen HTTP/JSON fixture’ları hazırlanmalı:

1. İki workspace, yönetici/çalışan/özel sohbet erişim matrisi.
2. Yetki kaldırıldıktan sonra cevap, bildirim ve SSE redaksiyonu.
3. Eşzamanlı boş sohbet isteğinin tek taslak üretmesi.
4. Lease kaybı, retry, eski worker yazma reddi.
5. Model timeout, bozuk akış, eksik terminal event, geçersiz citation.
6. Türkçe normalizasyon, PDF metni, chunk ve hash eşdeğerliği.
7. UTC/İstanbul otomasyon zamanlaması, tekrarların engellenmesi, arşivlenmiş sohbet.
8. Dosya yolu kaçışı, boyut limitleri, MCP ve ağ politikası.
9. Mevcut DB/oturum/dosyalarla geri dönüş ve restore.

Başlangıç testleri: `backend/tests/test_assistant_conversations.py`,
`test_colleague.py`, `test_agent_model.py`, `test_signal_permissions.py`, `test_automations.py`.

Performans aynı makine/corpus/DB/iş yükünde karşılaştırılmalı. Deterministik model stub’ı ile
uygulama maliyeti; gerçek sağlayıcı ile kullanıcı gecikmesi ayrı ölçülmeli. LLM ücretinin veya
token üretim hızının backend dili değişti diye iyileştiği varsayılmamalı.

## Sonuç ve sınır

**Taşınabilir: Evet. Şimdi tam taşıma: Gerekçesi henüz kanıtlanmış değil.**
İzge’nin riskli ve değerli kısmı HTTP değil; doğru kişiye, güncel izinle, gerçek kanıtlı cevap
üretme zinciri. Önce ölçmek, gerekirse yalnız darboğazı taşımak en küçük güvenli yol.

Bu rapor için Rust prototipi, benchmark, canlı sağlayıcı denemesi veya browser testi yapılmadı.
Kod incelemesi test çalıştırmanın yerine geçmez; rapor bağımsız bir performans sonucu sunmaz.
Efor tahminidir; en büyük risk izin/kanıt/retry davranışının fark edilmeden değişmesidir.

# izge.dev + app.izge.dev — Render / Railway

12 Ekim 2026. **Repo hazırlığıdır; hesap, DNS ve canlı dağıtım yapılmadı.**

## Topoloji

- `izge.dev`: statik `website/`; demo bağlantıları zaten `https://app.izge.dev`.
- `app.izge.dev`: kök `Dockerfile`; Nginx + API + gerçek `app.colleague_worker`.
- Supervisord süreçleri yeniden başlatır ve kapanış sinyallerini süreç gruplarına iletir.
- Tek instance, tek kalıcı disk `/data`: SQLite, yüklenen dosyalar ve yapıştırılan kaynaklar.
- API yalnız container içi 127.0.0.1:8000 dinler; dış giriş Nginx `PORT`.
- SSE buffering kapalı; frontend/API aynı origin, ayrıca CORS izni gerekmez.

Bu bilinçli bir demo topolojisidir. SQLite dosyasını iki ayrı host servisine bağlamayın.
[Render diskleri tek instance ile sınırlıdır](https://render.com/docs/disks);
[Railway volume](https://docs.railway.com/volumes) bir servise runtime'da bağlanır.
Yatay ölçekleme gerekecekse PostgreSQL + ortak nesne depolaması + ayrı worker kararı gerekir;
bu hazırlıkta veri katmanı değiştirilmedi. Diskli dağıtım kısa kesinti içerebilir.

## Render

Repo kökündeki `render.yaml` iki servisi tanımlar:
- Docker uygulaması, Frankfurt, `0.5c-512mb`, tek instance, 1 GB disk.
- Statik website, yayın dizini `website`.

Bu **ücretli compute + disk** gerektirir. Plan yük testiyle boyutlandırılmadı; eşzamanlı PDF ve
AI işleri için bellek ölçülmeli, gerekirse artırılmalı.
[Blueprint sözleşmesi](https://render.com/docs/blueprint-spec),
[güncel plan adları](https://render.com/docs/compute-plans).

1. Repoyu Blueprint olarak bağla; admin email/parolayı secret alanlarında sağla.
2. Aşağıdaki model değişkenlerini seçilen sağlayıcıya göre gir.
3. İlk açılış boş/veri içermeyen bir çalışma alanı oluşturur. Otomatik ortak parolalı seed kapalıdır.
4. Servis domain ayarlarında `izge.dev` ve `app.izge.dev` doğrulansın.
5. DNS değerlerini **provider'ın o servise verdiği gerçek değerlerden** al.
   [Render custom domains](https://render.com/docs/custom-domains).
   Repoda IP/CNAME hedefi uydurulmadı.
6. TLS hazır olmadan kullanıcı girişini açma.

Migration entrypoint içinde, disk bağlandıktan sonra çalışır; build/pre-deploy aşamasında değil.

## Railway

İki ayrı servis, aynı repo:
1. **App:** repo root, Dockerfile path `Dockerfile`; `/data` volume ekle;
   replica sayısı 1; health path `/health`; domain `app.izge.dev`.
2. **Website:** repo root, `RAILWAY_DOCKERFILE_PATH=deploy/website.Dockerfile`;
   domain `izge.dev`, target port **80**. App için platformun verdiği `PORT` kullanılır.
3. Start command override koyma: image ENTRYPOINT migration + supervisor başlatır.
4. Aynı secret/model değişkenlerini app servisine ekle.
5. DNS/TLS sağlayıcının domain panelindeki gerçek kayıtlarla tamamlanır.

[Railway Dockerfile yolu](https://docs.railway.com/builds/dockerfiles),
[Railway servis/depolama modeli](https://docs.railway.com/services).
Railway ayarları henüz provider hesabında uygulanmadı.

Şifresiz Kerem/Selin demo girişi, saatlik IP kotası, website 502 kontrolü ve mevcut
mock veri aktarımı için [Public demo](PUBLIC_DEMO.md) rehberini kullanın.

## Zorunlu konfigürasyon ve güvenlik kapıları

```dotenv
IZGE_DEFAULT_ADMIN_EMAIL=<kontrolünüzdeki-email>
IZGE_DEFAULT_ADMIN_PASSWORD=<benzersiz-uzun-parola>
IZGE_DEMO_SEED_ENABLED=false
IZGE_LOCAL_LLM_ENABLED=false
# Örnek: kullanılacak gerçek sağlayıcı; ücret ve veri sınırı onaylanmalı.
IZGE_AGENT_MODEL_PROVIDER=deepseek
IZGE_AGENT_DEEPSEEK_API_KEY=<provider-secret>
```

Alternatifler `docs/MODEL_PROVIDERS.md` içinde. Sağlayıcı seçimi/anahtarı olmadan UI/API açılabilir
ama AI çalışmaları tamamlanmaz. Cloud ortamında `host.docker.internal`, yerel Ollama veya
kişisel Codex OAuth köprüsü var kabul edilmez. OAuth/anahtarları image'a kopyalamayın.

- Admin hesabı ve demo çalışan hesapları ayrı olmalı; ziyaretçiye admin parola verme.
- Eski yerel DB içindeki şirket/kişisel verileri onaysız yükleme; anonim demo fixture'ı kullan.
- Eski parolalar/session'lar internet öncesi yenilenmeli.
- Public deneme model maliyeti ve dosya yükleme riski getirir; genel davet yerine kontrollü erişim.
- Production Nginx yalnız TLS sonlandıran Render/Railway proxy arkasında kullanılmalı.
  API'ye `X-Forwarded-Proto=https` sabit iletilir: session cookie Secure olur.
- İstemciden gelen X-Forwarded-For zinciri bilinçli olarak kopyalanmaz. Nginx doğrudan peer IP'sini
  verir; provider edge arkasında IP bazlı rate-limit birden fazla kullanıcıyı birlikte sınırlayabilir.
  Provider'a özel güvenilir proxy aralıkları doğrulanmadan keyfî header'a güvenilmez.
- API/user işlemleri uygulama auth ve workspace izinlerini korur; frontend tek başına yetki kapısı değildir.
- Backend süreçleri www-data; supervisor/Nginx başlangıcı root. Disk izinleri entrypoint'te ayarlanır.
- `/health` API sağlığını kontrol eder, model sağlayıcısını veya worker iş başarısını kanıtlamaz.
  Worker ayrıca `supervisorctl -c /etc/supervisor/conf.d/izge.conf status` ve loglardan izlenmeli.
- Mevcut bağımlılık güvenlik uyarıları yayından önce ayrıca çözülmeli.

## Yedek, restore ve rollback

Canlı SQLite dosyasını WAL etkin yazma sırasında sıradan cp ile yedekleme.
Python sqlite3 `Connection.backup` veya SQLite online backup kullan; storage/pasted dosyalarını da al.
Yedeği aynı disk dışında sakla. Platform disk snapshot'ını tek başına DB restore kanıtı sayma.

Eski volume otomatik kopyalanmaz/silinmez. Yerel eski veriyi kullanma yolu
[LOCAL_DEMO.md](LOCAL_DEMO.md) içinde. Restore önce izole diskte denenmeli.
Kod rollback'i şema downgrade'i değildir: migration varsa eski image'ın yeni şemayla
uyumluluğunu kanıtla veya doğrulanmış DB+dosya yedeğine kontrollü dön.

## Doğrulama ve açık kapılar

Kod düzeyinde test/build/config kontrolleri ayrı raporlanır. Bu dosya başarılı cloud deploy
iddiası değildir. Hesap, ücretli plan onayı, model anahtarı, DNS/TLS, anonim veri, restore denemesi,
worker/streaming canlı kabulü ve bağımlılık güvenlik kontrolü yayına çıkış kapılarıdır.
Browser testi yapılmadı.

Eski yönetim sistemine ait repo config/helper'ları kaldırıldı. Çalışan yerel container'lar,
yönetim verileri ve product volume bu değişiklikle silinmedi; tarihli verification dokümanları
tarihsel kayıt olarak korunur.

## Hobby hesabı + bulut LLM kararı

Demo için Render Hobby workspace veya Railway Hobby hesabı kullanılabilir; bunlar ücretsiz
compute garantisi değildir. Render'da mevcut SQLite topolojisi ücretli web compute ve disk
ister. Railway Hobby aylık 5 USD kullanım içerir, aşan kaynak kullanımı ayrıca faturalanır.
Güncel koşullar: https://render.com/docs/faq ve https://docs.railway.com/pricing/plans.

Model host üzerinde çalışmayacak. GPU, Ollama ve kişisel Codex köprüsü gerekli değil.
Render Blueprint sağlayıcıyı kurulumda sorar; Railway'de aynı değişken elle girilir.
Seçilen sağlayıcının anahtarını yalnız hosting secret değişkenlerine ekleyin:

| Seçim | Provider | Secret | Varsayılan efor |
|---|---|---|---|
| DeepSeek | IZGE_AGENT_MODEL_PROVIDER=deepseek | IZGE_AGENT_DEEPSEEK_API_KEY | IZGE_AGENT_MODEL_EFFORT=none |
| GLM | IZGE_AGENT_MODEL_PROVIDER=glm | IZGE_AGENT_GLM_API_KEY | IZGE_AGENT_MODEL_EFFORT=low |

İki anahtar da eklenirse iki seçenek arayüzde kullanılabilir; varsayılan provider tek kalır.
Anahtarları VITE_* değişkeni, Docker build arg, frontend veya repoya yazmayın.
Hosting faturası ile model sağlayıcısının token faturası ayrıdır. Sağlayıcı API kotası/bütçesi
ayrıca sınırlandırılmalı; demo otomasyonlarının da model tükettiği unutulmamalı.
512 MB mevcut başlangıç konfigürasyonudur, kapasite garantisi değildir; PDF/worker/API birlikte
çalışırken bellek ölçülerek artırılmalı. Bu not canlı sağlayıcı testi veya yük testi değildir.

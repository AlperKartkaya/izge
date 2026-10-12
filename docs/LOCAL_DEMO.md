# Yerel demo

Yerel geliştirme ve demo Docker Compose ile çalışır; yönetim paneli bağımlılığı yoktur.

```sh
scripts/local-demo.sh
```

- Uygulama: http://localhost:8080
- Website: http://localhost:8081
- Backend: http://localhost:8002
- Varsayılan veri: `backend/data/` bind mount.
- Anahtarlar: repo kökünde gitignored `.env`; bkz. [model sağlayıcıları](MODEL_PROVIDERS.md).
- Gerçek internet dağıtımı: [Render / Railway](DEPLOYMENT.md).

## Önceki yerel veriyi koruma

Eski kurulumun `izge-product-data` Docker volume'ü otomatik taşınmaz veya silinmez.
Aynı portlarda eski container çalışıyorsa yeni Compose başlatılmaz; önce DB online yedeği ve
kaynak dosyaları alınmalı, yalnız eski ürün süreçleri durdurulmalı. Eski yönetim sistemi
repo tarafından artık kullanılmaz; bu değişiklik çalışan container'ları otomatik silmez.

Eski veriyle bilinçli geçiş için:

```sh
docker compose -f docker-compose.yml -f deploy/local-preserved-data.compose.yml up -d --build
```

Bu override iki süreci aynı var olan volume'e bağlar. `docker compose down -v` veya
`docker volume rm` kullanmayın. Yedeği doğrulamadan restore veya veri kopyalama yapmayın.
Eski kullanıcı/parolaları internet ortamına taşımayın; kişisel/şirket verilerini anonimleştirin.

## Yerel model

Ollama host üzerinde çalışabilir. Docker Desktop `host.docker.internal` adresini kullanır.
İsteğe bağlı Codex köprüsü yalnız geliştirici makinesinde kurulmalıdır; OAuth dosyaları image'a
kopyalanmaz. Köprü kurulumu: `python3 scripts/setup-codex-bridge.py`.
Köprü token'ı ve URL'si `.env` içinde açıkça yapılandırılır; otomatik kontrol paneli enjeksiyonu yoktur.

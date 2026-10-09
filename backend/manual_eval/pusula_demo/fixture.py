from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any


FIXTURE_ROOT = Path(__file__).resolve().parent
PRELOADED_ROOT = FIXTURE_ROOT / "preloaded"
LIVE_UPLOAD_ROOT = Path(__file__).resolve().parents[3] / "docs" / "demo" / "live-upload"
WORKSPACE_NAME = "Pusula Yazılım ve IT Danışmanlık"
SEED_BATCH = "pusula-b2b-demo-v1"

PERSONAS = (
    {"key": "selin", "display_name": "Selin Aras", "title": "Team Lead", "email": "selin@pusula.demo", "role": "Admin"},
    {"key": "deniz", "display_name": "Deniz Yılmaz", "title": "Software Engineer", "email": "deniz@pusula.demo", "role": "Member"},
    {"key": "ece", "display_name": "Ece Yalın", "title": "Business Analyst", "email": "ece@pusula.demo", "role": "Member"},
    {"key": "mert", "display_name": "Mert Kaya", "title": "Operations Lead", "email": "mert@pusula.demo", "role": "Member"},
    {"key": "derya", "display_name": "Derya Akın", "title": "Human Resources Lead", "email": "derya@pusula.demo", "role": "Member"},
    {"key": "kerem", "display_name": "Kerem Demir", "title": "Software Engineer", "email": "kerem@pusula.demo", "role": "Member"},
)

ARTIFACTS = (
    ("atlas_contract", "Atlas Lojistik Hizmet Sözleşmesi", "01_atlas_hizmet_sozlesmesi.md", {1}),
    ("atlas_invoice", "Atlas Lojistik Eylül Faturası", "02_atlas_eylul_faturasi.md", {1}),
    ("atlas_delivery", "Atlas Ek İş Teslimi ve Günlükler", "03_atlas_ek_is_teslim_ve_gunlukler.md", {1}),
    ("atlas_requests", "Atlas Müşteri Talepleri", "04_atlas_musteri_talepleri.md", {2}),
    ("atlas_tickets", "Atlas Ticket Dökümü", "05_atlas_ticket_listesi.md", {2, 5}),
    ("atlas_support", "Atlas Destek Geçmişi ve Müşteri Riski", "06_atlas_destek_gecmisi.md", {3, 5}),
    ("atlas_root_cause", "Atlas Zaman Aşımı Kök Neden Notu", "07_atlas_teknik_kok_neden_notu.md", {3, 5, 6}),
    ("koru_spec", "Koru İhalesi Ana Şartnamesi", "08_koru_ana_sartname.md", {4}),
    ("koru_checklist", "Koru Teklif Paketi Kontrol Listesi", "09_koru_teklif_paketi_kontrol.md", {4}),
    ("staging_handoff", "Atlas Staging Erişim Teslim Notu", "10_staging_erisim_teslim_notu.md", {6}),
)

LIVE_UPLOAD_FILENAMES = {
    "koru-ihale-zeyilname-2.md",
    "atlas-ek-is-talebi-ticari-degisiklik.md",
}


def _thread(thread_id: str, title: str, kind: str, participants: list[str]) -> dict[str, Any]:
    return {
        "channel": thread_id,
        "thread_id": thread_id,
        "thread_title": title,
        "thread_kind": kind,
        "participant_keys": participants,
        "seeded": True,
        "seed_batch": SEED_BATCH,
    }


CHAT_MESSAGES = (
    (datetime(2026, 10, 5, 9, 12), "ece", "Atlas'ın toplu adres düzeltmesi ve geçmiş kayıt temizliği teslim edildi. Günlüklerde toplam 18 saat görünüyor.", _thread("atlas-commercial", "Atlas · Ticari takip", "group", ["ece", "deniz", "kerem", "selin"])),
    (datetime(2026, 10, 5, 9, 18), "deniz", "Benim kaydım 10 saat: 6 saat adres düzeltme, 4 saat veri doğrulama ve mutabakat raporu. İkisi de teslim edildi. Kerem'in temizliği de 8 saatti.", _thread("atlas-commercial", "Atlas · Ticari takip", "group", ["ece", "deniz", "kerem", "selin"])),
    (datetime(2026, 10, 5, 9, 24), "kerem", "Evet, 8 saatlik geçmiş kayıt temizliğini teslim notuna ekledim. Atlas üretimde doğruladı.", _thread("atlas-commercial", "Atlas · Ticari takip", "group", ["ece", "deniz", "kerem", "selin"])),
    (datetime(2026, 10, 5, 9, 31), "ece", "Fatura dökümünde yalnızca aylık bakım var; ek iş kalemi göremedim. Ticari kontrol açıyorum.", _thread("atlas-commercial", "Atlas · Ticari takip", "group", ["ece", "deniz", "kerem", "selin"])),
    (datetime(2026, 10, 5, 9, 37), "selin", "Sözleşmedeki kapsam dışı saat ücretini teslim kanıtıyla karşılaştıralım; müşteriye gitmeden önce tutarı netleştirelim.", _thread("atlas-commercial", "Atlas · Ticari takip", "group", ["ece", "deniz", "kerem", "selin"])),

    (datetime(2026, 10, 7, 10, 2), "ece", "Atlas, Excel aktarım talebini yeniden sordu. 18 Eylül'de 'hallederiz' demiştim ama iş listesinde bulamadım.", _thread("atlas-requests", "Atlas · Müşteri talepleri", "group", ["ece", "deniz", "selin"])),
    (datetime(2026, 10, 7, 10, 7), "deniz", "Excel özelliğine henüz başlayamadım. Bunun için bana atanmış bir ticket yok; geçen haftaki veri düzeltme işi farklıydı.", _thread("atlas-requests", "Atlas · Müşteri talepleri", "group", ["ece", "deniz", "selin"])),
    (datetime(2026, 10, 7, 10, 11), "selin", "Müşteriye tarih vermeden önce talebi ve sorumluyu netleştirelim. Bu konuşma arada kaybolmasın.", _thread("atlas-requests", "Atlas · Müşteri talepleri", "group", ["ece", "deniz", "selin"])),
    (datetime(2026, 10, 7, 10, 15), "ece", "Müşteri mesajını Hafıza'ya ekledim; bugün ticket ve sorumlu çıkarmamız gerekiyor.", _thread("atlas-requests", "Atlas · Müşteri talepleri", "group", ["ece", "deniz", "selin"])),

    (datetime(2026, 10, 7, 14, 6), "deniz", "Atlas'tan zaman aşımı şikâyeti bana da geldi. Temmuz olayında servisi yeniden başlatmıştım.", _thread("atlas-support", "Atlas · Destek ve yenileme riski", "group", ["deniz", "kerem", "ece", "selin", "derya"])),
    (datetime(2026, 10, 7, 14, 10), "kerem", "Ağustos ve Eylül'de de aynı müdahale yapılmış. Loglarda connection pool tükenmesi ortak görünüyor.", _thread("atlas-support", "Atlas · Destek ve yenileme riski", "group", ["deniz", "kerem", "ece", "selin", "derya"])),
    (datetime(2026, 10, 7, 14, 14), "ece", "Müşteri üç aydır aynı şeyi farklı kişilere anlattığını söyledi; Aralık yenilemesini sorguluyor.", _thread("atlas-support", "Atlas · Destek ve yenileme riski", "group", ["deniz", "kerem", "ece", "selin", "derya"])),
    (datetime(2026, 10, 7, 14, 18), "selin", "Bu artık tekil destek kaydı değil, müşteri riski. Kalıcı plan ve tek sorumlu belirleyelim.", _thread("atlas-support", "Atlas · Destek ve yenileme riski", "group", ["deniz", "kerem", "ece", "selin", "derya"])),
    (datetime(2026, 10, 7, 14, 23), "derya", "Aynı olaya her ay müdahale etmek ekip kapasitesini de tüketiyor. Kök neden işi için odak zamanı ayırabiliriz.", _thread("atlas-support", "Atlas · Destek ve yenileme riski", "group", ["deniz", "kerem", "ece", "selin", "derya"])),

    (datetime(2026, 10, 8, 11, 5), "ece", "Koru ana şartnamesindeki beş zorunlu belge hazır. Bugün son kontrol listesini kapatıyorum.", _thread("koru-tender", "Koru · İhale hazırlığı", "group", ["ece", "selin", "mert", "derya", "deniz"])),
    (datetime(2026, 10, 8, 11, 11), "deniz", "Teknik çözüm ve mimari yaklaşım tamam. Kaynak kod eki istenmiyor.", _thread("koru-tender", "Koru · İhale hazırlığı", "group", ["ece", "selin", "mert", "derya", "deniz"])),
    (datetime(2026, 10, 8, 11, 16), "derya", "İmza sirkülerinin güncel kopyasını pakete koydum.", _thread("koru-tender", "Koru · İhale hazırlığı", "group", ["ece", "selin", "mert", "derya", "deniz"])),
    (datetime(2026, 10, 8, 11, 21), "ece", "Son başvuru 12 Ekim 17:00. Yeni zeyilname gelirse kontrol listesini yeniden açmamız gerekecek.", _thread("koru-tender", "Koru · İhale hazırlığı", "group", ["ece", "selin", "mert", "derya", "deniz"])),

    (datetime(2026, 10, 8, 15, 2), "ece", "ATL-427 kabul testi için atlas-staging VPN ve log erişimini bekliyorum. Operasyon onayı olmadan ilerleyemiyorum.", _thread("atlas-delivery", "Atlas · Kalıcı düzeltme teslimi", "group", ["ece", "deniz", "selin"])),
    (datetime(2026, 10, 8, 15, 8), "deniz", "Düzeltme dalı hazır. Erişim açılırsa test senaryosunu bugün çalıştırabiliriz.", _thread("atlas-delivery", "Atlas · Kalıcı düzeltme teslimi", "group", ["ece", "deniz", "selin"])),
    (datetime(2026, 10, 8, 15, 13), "selin", "Talebin Operasyona gittiğini sanıyordum. Ece, hangi kanaldan ilettik?", _thread("atlas-delivery", "Atlas · Kalıcı düzeltme teslimi", "group", ["ece", "deniz", "selin"])),
    (datetime(2026, 10, 8, 15, 18), "ece", "Buraya yazdım ama Mert'i eklememişim; ayrıca ona atanmış bir iş de görünmüyor.", _thread("atlas-delivery", "Atlas · Kalıcı düzeltme teslimi", "group", ["ece", "deniz", "selin"])),

    (datetime(2026, 10, 8, 15, 6), "mert", "Bugün bekleyen staging erişim onayı var mı? Operasyon kuyruğunda Atlas adına kayıt göremiyorum.", _thread("operations", "Operasyon", "group", ["mert", "kerem", "derya"])),
    (datetime(2026, 10, 8, 15, 10), "kerem", "Ben connection pool testi için erişim gerekeceğini not ettim ama onay talebini açan kişi değilim.", _thread("operations", "Operasyon", "group", ["mert", "kerem", "derya"])),
    (datetime(2026, 10, 8, 15, 14), "mert", "Bana kişi, ortam ve süre bilgisi gelirse bugün açabilirim. Şu an kime erişim gerektiğini bilmiyorum.", _thread("operations", "Operasyon", "group", ["mert", "kerem", "derya"])),
    (datetime(2026, 10, 8, 15, 19), "derya", "Bekleyen iş iki ekip arasında kalmış görünüyor. Kısa bir onay görevi oluşturup doğrudan Mert'e iletelim.", _thread("operations", "Operasyon", "group", ["mert", "kerem", "derya"])),
)

TASKS = (
    {"key": "atlas_root_cause", "title": "ATL-427 connection pool kök nedenini doğrula", "description": "Üç aylık zaman aşımı kayıtlarını birleştir; yük testi ve kalıcı düzeltme kanıtını hazırla.", "assignee": "kerem", "status": "in_progress", "due_at": datetime(2026, 10, 10, 15, 0), "sources": ["atlas_support", "atlas_root_cause"]},
    {"key": "atlas_retention", "title": "Atlas yenileme riskine yanıt planı hazırla", "description": "Tek sorumlu, kalıcı çözüm takvimi ve müşteri bilgilendirmesini 10 Ekim'e kadar hazırla.", "assignee": "selin", "status": "open", "due_at": datetime(2026, 10, 10, 12, 0), "sources": ["atlas_requests", "atlas_support"]},
    {"key": "koru_final_check", "title": "Koru teklif paketinin son belge kontrolünü yap", "description": "Ana şartname ve yayımlanabilecek zeyilnameleri son başvurudan önce karşılaştır.", "assignee": "ece", "status": "in_progress", "due_at": datetime(2026, 10, 12, 12, 0), "sources": ["koru_spec", "koru_checklist"]},
    {"key": "staging_access", "title": "Atlas staging erişim onayını Operasyona aktar", "description": "Ece için atlas-staging VPN ve salt okunur log erişimi gerekiyor; onaylayacak kişi henüz atanmamış.", "assignee": None, "status": "open", "due_at": datetime(2026, 10, 9, 16, 0), "sources": ["staging_handoff", "atlas_root_cause"]},
)


def validate_fixture() -> None:
    covered = {case for *_prefix, cases in ARTIFACTS for case in cases}
    assert covered == set(range(1, 7)), f"Eksik use case: {sorted(set(range(1, 7)) - covered)}"
    preloaded_names = {filename for _key, _title, filename, _cases in ARTIFACTS}
    assert not (preloaded_names & LIVE_UPLOAD_FILENAMES), "Canlı yükleme dosyası seed manifestine girmiş"
    assert {path.name for path in LIVE_UPLOAD_ROOT.glob("*.md")} == LIVE_UPLOAD_FILENAMES
    for _key, _title, filename, _cases in ARTIFACTS:
        text = (PRELOADED_ROOT / filename).read_text(encoding="utf-8")
        assert len(text) > 200, f"Fixture içeriği yetersiz: {filename}"
        assert "KVKK Veri İşleyen Taahhütnamesi" not in text, f"Canlı ihale koşulu önceden sızmış: {filename}"
    assert "36.000 TL" in (PRELOADED_ROOT / "03_atlas_ek_is_teslim_ve_gunlukler.md").read_text(encoding="utf-8")
    assert not any("Excel" in task["title"] or "dışa aktar" in task["title"] for task in TASKS), "Unutulan talep için ticket oluşturulmamalı"
    thread_counts: dict[str, int] = {}
    for _created_at, _author, _body, metadata in CHAT_MESSAGES:
        thread_counts[metadata["thread_id"]] = thread_counts.get(metadata["thread_id"], 0) + 1
    assert all(3 <= count <= 6 for count in thread_counts.values()), thread_counts

# IZGE button-icon sheets — image-generator prompt

Aşağıdaki prompt yeni üretimler için image generator agent’e olduğu gibi verilebilir. Teslim edilen dört PNG `docs/design/icons/incoming/` içinde korunur; 36 kırpılmış ikon `frontend/src/assets/button-icons/` altında uygulamaya entegre edilmiştir. İkonlar tek renkli **alpha mask** olarak `currentColor` ile kullanılacak: şeffaf arka plan tek başına çok renkli bir PNG’yi yeniden renklendirmez.

`manifest.json` hücre koordinatlarının ve anlamlarının kaynağıdır. Satır ve sütunlar 1’den başlar. `crop` alanı PNG piksel koordinatında `[left, top, right, bottom]`; sağ/alt sınır hariçtir. Sıra soldan sağa, yukarıdan aşağıdır. Agent boyutu değiştirmişse kırpma öncesi yeni boyut doğrulanır; görüntüde eksik/dolu arka plan varsa sessizce kullanılmaz.

## Copy this complete prompt

You are an image-generation agent creating a consistent button-icon set for **IZGE**, a self-hosted company-memory and colleague-agent application used by a B2B software development and IT consulting company. Generate **four separate, downloadable PNG files**, named exactly **sheet1.png, sheet2.png, sheet3.png, sheet4.png**. Each sheet must contain **exactly nine distinct icons** in a **3 × 3 grid** in the exact positions listed below. Do not return only an embedded preview: provide a download link for each file, followed by a brief cell-position inventory. Do not substitute a single collage or a PDF.

### Non-negotiable asset specifications

- Each file: **1536 × 1536 pixels, RGBA PNG, genuine transparent alpha background**. No opaque background, checkerboard drawn into the image, grid lines, cell borders, labels, numerals, text, captions, watermarks, brand letters, decorative frame, shadows, gradients, glow, blur or 3D effects.
- Every cell is exactly **512 × 512 pixels**. Center one icon in each cell. All visible pixels of the icon must fit inside the central **288 × 288 pixel** safe box (112 px minimum margin on all four sides). Nothing may cross cell boundaries.
- Use a clean, restrained, contemporary **monochrome outlined icon style** suitable for enterprise chat buttons. Solid **white glyph pixels** with transparent background and transparent cut-outs. White is a neutral alpha-mask carrier, not an instruction to paint white rectangles.
- Same visual weight across all 36 icons: nominal **20 px stroke at sheet scale**, smooth rounded caps and joins, optical size around 240–288 px. Clean edges; mild antialiasing only. Simple recognizable silhouettes that remain readable at 20–24 px after cropping/downscaling. Avoid overly detailed miniatures and thin hairlines. Preserve intentionally hollow task rings and the progress icon’s half-filled shape.
- All sheets must use the same style, stroke thickness, padding and optical scale. Do not vary color/style between sheets. Interpret the function descriptions as semantic guidance only: **never write these descriptions into the PNG**.
- The tables below use **1-based row/column coordinates**. Row 1 is top; column 1 is left. Read cells left-to-right, top-to-bottom. Each ID is metadata only, not text to draw.
- If the image model cannot directly emit 1536 × 1536, normalize the result to that exact square size without changing transparency, icon order or proportions before delivering. Check each downloadable PNG’s actual dimensions, alpha channel and nine occupied cells; report any failure rather than claiming compliance.

### UI use decision

`icon-only` means the icon may replace the visible button text, but IZGE will retain a localized accessible name and tooltip; do not draw text in the asset. `with-label` means the icon accompanies the existing Turkish/English label. Navigation, ambiguous actions, destructive operations and primary business actions retain their labels. File/source titles and notification counts remain application text, never pixels inside an icon. Do not invent extra actions or replace text anywhere else.

### sheet1.png

| Row | Column | ID | Visual | IZGE function | Button treatment |
|---|---|---|---|---|---|
| 1 | 1 | `home` | Small house | Ana sayfa: günlük özet ve açık işlere git | with-label |
| 1 | 2 | `ask-izge` | Speech bubble with a four-point spark | İzge’ye sor: şirket kaynaklarına dayalı agent konuşmasını aç | with-label |
| 1 | 3 | `team-chat` | Two overlapping speech bubbles | Ekip sohbeti: çalışma arkadaşlarının konuşmalarını aç | with-label |
| 2 | 1 | `memory` | Document with three connected memory nodes | Hafıza: kaynak dosyaları ve şirket kayıtlarını aç | with-label |
| 2 | 2 | `tasks` | Checklist with two ticks | İşlerim: işleri ve durumlarını aç | with-label |
| 2 | 3 | `automations` | Circular arrow around a small gear | Otomasyonlar: İzge’nin rutinlerini ve zamanlamalarını aç | with-label |
| 3 | 1 | `notifications` | Bell with a small notification dot | Bildirimler: mesaj ve İzge uyarılarını aç | with-label |
| 3 | 2 | `search` | Magnifying glass | Konuşma ve kaynak arama | icon-only |
| 3 | 3 | `language` | Globe with simple meridians | Türkçe/English dil seçimini belirt; seçili dil yazısı yanında | with-label |

### sheet2.png

| Row | Column | ID | Visual | IZGE function | Button treatment |
|---|---|---|---|---|---|
| 1 | 1 | `send` | Upward arrow | Hazırlanmış sohbet mesajını gönder | icon-only |
| 1 | 2 | `attach` | Paperclip | Bulunulan sohbete dosya eklemek için dosya seçiciyi aç | icon-only |
| 1 | 3 | `add` | Plus sign | Yeni sohbet, grup, iş veya otomasyon oluştur | with-label |
| 2 | 1 | `close` | Diagonal X | Önizleme veya oluşturma penceresini kapat | icon-only |
| 2 | 2 | `open-source` | Document with a tiny magnifying glass | Kaynak alıntısını uygulama içi önizleme penceresinde aç | with-label |
| 2 | 3 | `download` | Downward arrow entering a tray | Ek veya kaynak dosyasını indir | with-label |
| 3 | 1 | `new-group` | Three person silhouettes with a small plus | Yeni ekip konuşması oluştur | with-label |
| 3 | 2 | `sign-out` | Doorway with rightward exit arrow | Oturumu kapat | with-label |
| 3 | 3 | `theme` | Circle split into a sun half and crescent moon half | Açık/koyu görünümü değiştir; hedef tema yazısı yanında | with-label |

### sheet3.png

| Row | Column | ID | Visual | IZGE function | Button treatment |
|---|---|---|---|---|---|
| 1 | 1 | `task-open` | Empty circular ring | İş açık; tıklayınca Devam ediyor durumuna geç | icon-only |
| 1 | 2 | `task-progress` | Circular ring half filled with a short clock hand | İş devam ediyor; tıklayınca Tamamlandı durumuna geç | icon-only |
| 1 | 3 | `task-done` | Circle enclosing a check mark | İş tamamlandı; tıklayınca Açık durumuna geri dön | icon-only |
| 2 | 1 | `reminder` | Small clock with a bell corner | İş için hatırlatma zamanı belirle | with-label |
| 2 | 2 | `edit` | Pencil on a short diagonal line | İşi veya otomasyonu düzenle | with-label |
| 2 | 3 | `save` | Simple floppy disk with no letters | Değişiklikleri kaydet | with-label |
| 3 | 1 | `delete` | Lidded trash bin | Kayıt veya otomasyonu sil; metin ve mevcut onay korunur | with-label |
| 3 | 2 | `pause` | Two vertical bars | Zamanlanmış otomasyonu duraklat | with-label |
| 3 | 3 | `run` | Right-pointing play triangle | Otomasyonu veya günlük değerlendirmeyi şimdi çalıştır | with-label |

### sheet4.png

| Row | Column | ID | Visual | IZGE function | Button treatment |
|---|---|---|---|---|---|
| 1 | 1 | `knowledge-graph` | Five connected circular nodes | Bilgi grafiği ve kaynak ilişkilerini aç | with-label |
| 1 | 2 | `ingestion` | Document entering a bracket via a downward arrow | Yönetici: kaynak işleme durumunu aç/işlemeyi başlat | with-label |
| 1 | 3 | `filesystem` | Folder with two tiny horizontal document lines | Yönetici: şirket hafızasının dosya görünümünü aç | with-label |
| 2 | 1 | `operations` | Activity pulse inside a rounded square | Yönetici: operasyon durumunu aç | with-label |
| 2 | 2 | `audit` | Shield with a check mark | Yönetici: denetim ve işlem kayıtlarını aç | with-label |
| 2 | 3 | `users` | Two simple person silhouettes | Yönetici: kullanıcıları ve ekip üyelerini aç | with-label |
| 3 | 1 | `copy` | Two overlapping rectangular pages | Mesaj veya kaynak metnini kopyala | with-label |
| 3 | 2 | `filter` | Funnel with a short stem | İşleri, kaynakları veya kayıtları filtrele | with-label |
| 3 | 3 | `refresh` | Single circular arrow | Listeyi yenile veya başarısız yüklemeyi tekrar dene | with-label |

## Delivery checklist

Return four downloadable transparent PNGs with these exact filenames. List sheet → row/column → ID in plain text beside the download links, not inside the images. Keep the grid positions unchanged even if an icon is harder to draw. Do not add placeholder icons, extra icons or generated UI screenshots.

## Alınan sheetler ve uygulamaya hazırlama

Gerçek teslimler 1254×1254 RGBA PNG; 3×3 sıra görsel olarak doğrulandı. Orijinaller `incoming/` içinde korunur. `python3 scripts/crop-button-icons.py` önce grid koordinatları için 1536×1536 normalizasyon yapar, her hücreyi kırpar, görünmez alfa gürültüsünü dışarıda bırakarak şeffaf boşluğu alır ve 232px glifi 256×256 şeffaf tuvale ortalar. Çıktılar `frontend/src/assets/button-icons/` altında ID adıyla bulunur; `ButtonIcon` bunları CSS mask + currentColor ile kullanır. 36 dosyanın boyutu, gerçek alfa kanalı, dolu ve merkezlenmiş glifi script tarafından doğrulanır. Henüz mevcut bir işleve karşılık gelmeyen ikon için yeni özellik eklenmez.

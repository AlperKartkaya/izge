const contractTr = `# Atlas Lojistik — Yazılım Bakım ve Danışmanlık Sözleşmesi

Sözleşme no: ATL-PUS-2026-04  
Yürürlük: 2026-04-01

## Aylık kapsam

Karar: Aylık sabit bakım bedeli; hata düzeltme, izleme ve ayda en fazla 24 saat destek hizmetini kapsar.

Kısıt: Yeni özellik geliştirme, toplu veri düzeltme ve geçmiş kayıtların temizlenmesi sabit bakım kapsamına dahil değildir.

Kısıt: Kapsam dışı çalışmalar müşteri talebi ve Pusula'nın teslim kaydı ile doğrulandığında saatlik **2.000 TL + KDV** üzerinden ayrıca ücretlendirilir.

Taahhüt: Pusula, kapsam dışı çalışma saatlerini ilgili ayın faturasına ekler ve teslim kanıtını faturayla birlikte paylaşır.

## Hizmet seviyesi

Kritik kesintilere 2 saat içinde ilk müdahale yapılır. Geçici servis yeniden başlatması kalıcı çözüm sayılmaz; tekrarlayan olaylar için kök neden analizi hazırlanır.
`;

const invoiceTr = `# Atlas Lojistik — Eylül 2026 Fatura Dökümü

Fatura no: PUS-2026-0918  
Fatura tarihi: 2026-10-02

| Kalem | Miktar | Birim fiyat | Tutar |
|---|---:|---:|---:|
| Aylık yazılım bakım hizmeti | 1 ay | 85.000 TL | 85.000 TL |

Sonuç: Faturada kapsam dışı geliştirme, toplu veri düzeltme veya geçmiş kayıt temizliği kalemi bulunmamaktadır.

Sonuç: Deniz ve Kerem'in Eylül ayındaki ek çalışma saatleri bu faturaya yansıtılmamıştır.

Toplam (KDV hariç): 85.000 TL
`;

const deliveryTr = `# Atlas Lojistik — Ek İş Teslim Kaydı ve Günlük Çalışma Notları

Teslim dönemi: 2026-09-22 / 2026-09-26  
Müşteri: Atlas Lojistik

## Teslim edilen kapsam dışı işler

- Deniz, 22-24 Eylül: Eski sevkiyat kayıtlarının toplu adres düzeltmesi — **6 saat**.
- Deniz, 25 Eylül: Toplu veri düzeltmesi sonrası sevkiyat verilerinin doğrulanması ve mutabakat raporu — **4 saat**.
- Kerem, 23-25 Eylül: 18.400 geçmiş sevkiyat kaydının temizlenmesi — **8 saat**.

Sonuç: Teslim edilen kapsam dışı çalışma toplamı **18 saattir**.

Sonuç: Sözleşmedeki saatlik 2.000 TL koşuluna göre, müşteri teyidi ve ticari onay sonrasında faturaya eklenebilecek potansiyel ücret **18 × 2.000 TL = 36.000 TL + KDV** tutarındadır; bu kayıt tek başına kesinleşmiş alacak değildir.

Taahhüt: Ece teslim kaydını ticari kontrole aktaracak; Selin fatura ekini onaylayacaktır.

## Teslim kanıtı

Atlas operasyon ekibi 26 Eylül saat 16:40'ta adres düzeltmesi, veri doğrulama raporu ve kayıt temizliğinin tamamını teslim aldığını e-postayla teyit etti. Yukarıdaki üç kalem de teslim edilmiştir. Excel dışa aktarım talebi bu teslimlerle ilgisiz, henüz başlanmamış ayrı bir özellik talebidir.
`;

const sourcesEn = [
  {
    id: 'contract',
    title: 'Atlas Logistics — Software Maintenance and Consulting Agreement',
    filename: '01_atlas_hizmet_sozlesmesi.md',
    summary: 'Out-of-scope work may be billed at ₺2,000 per hour plus VAT when the customer request and delivery record verify it.',
    body: `Relevant translated excerpt

The fixed monthly maintenance fee covers bug fixes, monitoring, and up to 24 hours of support each month.

New feature development, bulk data corrections, and cleanup of historical records are outside fixed maintenance.

Verified out-of-scope work is billed separately at ₺2,000 per hour plus VAT. Pusula adds those hours to the relevant monthly invoice and shares delivery evidence with it.`,
  },
  {
    id: 'delivery',
    title: 'Atlas Logistics — Additional Work Delivery Record and Daily Notes',
    filename: '03_atlas_ek_is_teslim_ve_gunlukler.md',
    summary: 'The delivery record totals 18 out-of-scope hours and marks ₺36,000 plus VAT as potential, subject to customer confirmation and commercial approval.',
    body: `Relevant translated excerpt

Delivered out-of-scope work: 6 hours of bulk address correction, 4 hours of verification and reconciliation reporting, and 8 hours cleaning 18,400 historical shipment records.

Total delivered out-of-scope work: 18 hours.

At the contract rate, the potential amount that may be added to the invoice after customer confirmation and commercial approval is 18 × ₺2,000 = ₺36,000 plus VAT. This record alone is not a finalized receivable.

Ece will send the delivery record for commercial review; Selin will approve the invoice attachment. Atlas operations confirmed receipt of all three delivered items by email on September 26 at 16:40.`,
  },
  {
    id: 'invoice',
    title: 'Atlas Logistics — September 2026 Invoice Breakdown',
    filename: '02_atlas_eylul_faturasi.md',
    summary: 'The ₺85,000 maintenance invoice contains no line item for the September out-of-scope work.',
    body: `Relevant translated excerpt

Monthly software maintenance service: 1 month × ₺85,000 = ₺85,000.

The invoice contains no line item for out-of-scope development, bulk data correction, or historical record cleanup. Deniz and Kerem's additional September hours were not reflected in this invoice.

Total excluding VAT: ₺85,000.`,
  },
];

const sourcesTr = [
  {
    id: 'contract',
    title: 'Atlas Lojistik — Yazılım Bakım ve Danışmanlık Sözleşmesi',
    filename: '01_atlas_hizmet_sozlesmesi.md',
    summary: 'Kapsam dışı iş, müşteri talebi ve teslim kaydıyla doğrulandığında saatlik 2.000 TL + KDV üzerinden ayrıca ücretlendirilebilir.',
    body: contractTr,
  },
  {
    id: 'delivery',
    title: 'Atlas Lojistik — Ek İş Teslim Kaydı ve Günlük Çalışma Notları',
    filename: '03_atlas_ek_is_teslim_ve_gunlukler.md',
    summary: 'Teslim kaydı 18 saatlik kapsam dışı işi ve müşteri teyidiyle ticari onaya bağlı 36.000 TL + KDV potansiyel ücreti gösteriyor.',
    body: deliveryTr,
  },
  {
    id: 'invoice',
    title: 'Atlas Lojistik — Eylül 2026 Fatura Dökümü',
    filename: '02_atlas_eylul_faturasi.md',
    summary: '85.000 TL tutarındaki bakım faturasında Eylül ayındaki kapsam dışı işler için bir kalem bulunmuyor.',
    body: invoiceTr,
  },
];

export const story = {
  en: {
    sources: sourcesEn,
    finding: {
      title: '18 delivered hours are absent from the September invoice',
      amount: 'Potential ₺36,000 + VAT',
      qualification: 'Illustrative, fixture-grounded review. Customer confirmation and commercial approval are required; this is not recovered revenue or a finalized receivable.',
      answer: 'The ₺85,000 invoice covers monthly maintenance only. The delivery record documents 18 out-of-scope hours, which the contract prices at ₺2,000 per hour plus VAT.',
    },
    team: [
      { name: 'Ece', role: 'person', body: '@izge, compare the September delivery record with the invoice. Is any delivered work missing?' },
      { name: 'Izge', role: 'izge', body: 'Illustrative review: the invoice lists only ₺85,000 maintenance. The delivery record lists 18 out-of-scope hours; at the contract rate, that is a potential ₺36,000 + VAT.' },
      { name: 'Selin', role: 'person', body: 'I will review the delivery evidence and customer confirmation before approving any invoice attachment.' },
      { name: 'Izge', role: 'izge', body: 'Human review remains required. The record is not a finalized receivable, and I have not created or sent an invoice.' },
    ],
    private: [
      { name: 'Ece', role: 'person', body: 'What should I bring to Selin for review?' },
      { name: 'Izge', role: 'izge', body: 'Bring the contract rate, the 18-hour delivery record, the September invoice, and the customer delivery confirmation. Selin makes the commercial approval.' },
    ],
  },
  tr: {
    sources: sourcesTr,
    finding: {
      title: 'Teslim edilen 18 saat Eylül faturasında yer almıyor',
      amount: 'Potansiyel 36.000 TL + KDV',
      qualification: 'Bu, fikstürlere dayalı temsili bir incelemedir. Müşteri teyidi ve ticari onay gerekir; kurtarılmış gelir veya kesinleşmiş alacak değildir.',
      answer: '85.000 TL tutarındaki fatura yalnızca aylık bakımı içeriyor. Teslim kaydı, sözleşmede saatlik 2.000 TL + KDV olarak fiyatlanan 18 saatlik kapsam dışı işi belgeliyor.',
    },
    team: [
      { name: 'Ece', role: 'person', body: '@izge, Eylül teslim kaydıyla faturayı karşılaştır. Teslim edilip faturada yer almayan iş var mı?' },
      { name: 'Izge', role: 'izge', body: 'Temsili inceleme: Faturada yalnızca 85.000 TL tutarındaki bakım var. Teslim kaydında 18 saatlik kapsam dışı iş bulunuyor; sözleşme bedeliyle potansiyel tutar 36.000 TL + KDV.' },
      { name: 'Selin', role: 'person', body: 'Herhangi bir fatura ekini onaylamadan önce teslim kanıtını ve müşteri teyidini inceleyeceğim.' },
      { name: 'Izge', role: 'izge', body: 'İnsan incelemesi gerekiyor. Kayıt kesinleşmiş alacak değil; bir fatura oluşturmadım veya göndermedim.' },
    ],
    private: [
      { name: 'Ece', role: 'person', body: 'İnceleme için Selin’e neleri sunmalıyım?' },
      { name: 'Izge', role: 'izge', body: 'Sözleşme bedelini, 18 saatlik teslim kaydını, Eylül faturasını ve müşterinin teslim teyidini sun. Ticari onayı Selin verir.' },
    ],
  },
};

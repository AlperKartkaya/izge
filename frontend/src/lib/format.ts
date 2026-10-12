import { currentLocale, getLanguage, translate } from './language.ts'

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/
const explicitZonePattern = /(Z|[+-]\d{2}:?\d{2})$/i

export function normalizeApiTimestamp(value: string): string {
  if (dateOnlyPattern.test(value) || explicitZonePattern.test(value)) {
    return value
  }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ? `${value}Z` : value
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return translate('Not available', 'Mevcut değil')
  }

  const parsed = new Date(normalizeApiTimestamp(value))
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Istanbul',
  }).format(parsed)
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return translate('Not available', 'Mevcut değil')
  }

  const parsed = new Date(normalizeApiTimestamp(value))
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(currentLocale(), {
    dateStyle: 'medium',
    timeZone: 'Europe/Istanbul',
  }).format(parsed)
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function formatLabel(value: string): string {
  return (getLanguage() === 'tr' ? statusLabels[value] ?? uiLabels[value] : englishStatusLabels[value]) ?? value.replace(/_/g, ' ')
}

const uiLabels: Record<string, string> = {
  decision: 'Karar', decisions: 'Kararlar', assumption: 'Varsayım', assumptions: 'Varsayımlar',
  constraint: 'Kısıt', constraints: 'Kısıtlar', outcome: 'Sonuç', outcomes: 'Sonuçlar',
  commitment: 'Taahhüt', commitments: 'Taahhütler', artifact: 'Kaynak', artifacts: 'Kaynaklar',
  memory: 'Hafıza', uploaded_file: 'Yüklenen dosya', pasted_text: 'Metin notu', team_chat_attachment: 'Sohbet eki',
  workspace: 'Çalışma alanı', restricted: 'Kısıtlı', Admin: 'Yönetici', Member: 'Çalışan',
  critical: 'Kritik', high: 'Yüksek', medium: 'Orta', low: 'Düşük', disabled: 'Devre dışı', enabled: 'Etkin',
  conflict: 'Çelişki', supports: 'Destekler', contradicts: 'Çelişir', supersedes: 'Günceller', references: 'Referans verir',
  orchestrator_plan: 'İş planlama', evidence_indexer: 'Kaynak tarama', memory_extractor: 'Hafıza çıkarımı',
  graph_linker: 'Kayıtlar arası bağlantılar', contradiction_interrogator: 'Çelişki incelemesi',
  assumption_drift_interrogator: 'Varsayım değişikliği incelemesi', guidance_planner: 'Sonraki adım önerileri',
  worker_queue_dispatcher: 'İş dağıtımı', provenance_verifier: 'Kaynak doğrulama',
  decision_lineage: 'Karar geçmişi', contradiction_check: 'Çelişki kontrolü', source_review: 'Kaynak incelemesi',
  'Launch cluster': 'Yayın grubu', 'Security cluster': 'Güvenlik grubu', 'Customer cluster': 'Müşteri grubu',
  'Engineering cluster': 'Mühendislik grubu', 'Operations cluster': 'Operasyon grubu', 'Company memory': 'Şirket hafızası',
}

const statusLabels: Record<string, string> = {
  active: 'Geçerli',
  stale: 'Yeniden incelenmeli',
  reversed: 'Tersine döndü',
  weakening: 'Zayıflıyor',
  assumption_drift: 'Varsayım değişikliği',
  next_action: 'Önerilen iş',
  continuity_overlap: 'İlgili önceki çalışma',
  contradiction: 'Çelişki',
  supersession: 'Güncellenen karar',
  open_commitment: 'Açık taahhüt',
  pending: 'Bekliyor',
  queued: 'Sırada',
  running: 'Çalışıyor',
  completed: 'Tamamlandı',
  failed: 'Başarısız',
  open: 'Açık',
  in_progress: 'Devam ediyor',
  done: 'Tamamlandı',
  submitted: 'İncelemede',
  needs_review: 'İnceleme gerekli',
  reviewed: 'İncelendi',
  rejected: 'Reddedildi',
}

const englishStatusLabels: Record<string, string> = { active: 'Active', stale: 'Needs review', reversed: 'Reversed', weakening: 'Weakening', assumption_drift: 'Assumption drift', next_action: 'Suggested task', continuity_overlap: 'Related previous work', contradiction: 'Contradiction', supersession: 'Updated decision', open_commitment: 'Open commitment', pending: 'Pending', queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', open: 'Open', in_progress: 'In progress', done: 'Done', submitted: 'Submitted', needs_review: 'Needs review', reviewed: 'Reviewed', rejected: 'Rejected' }

export function formatStatus(value: string): string {
  return (getLanguage() === 'tr' ? statusLabels[value] : englishStatusLabels[value]) ?? formatLabel(value)
}

// Translate only known system stages, never company records or source titles.
const systemStages: Record<string, string> = {
  'Çalışma güvenli biçimde yeniden başlatıldı': 'Work restarted safely',
  'Yeni kayıtlar hafızaya işleniyor': 'Adding new records to memory',
  'Kurumsal hafıza güncelleniyor': 'Updating company memory',
  'Kurumsal hafıza güncel': 'Company memory is up to date',
  'Şirket bilgileri taranıyor': 'Searching company information',
  'Güncel hafıza taranıyor': 'Searching updated memory',
  'Kaynaklar hazır': 'Sources are ready',
  'Yeni kayıt değerlendiriliyor': 'Reviewing the new record',
  'Yeni kayıt değerlendirildi': 'New record reviewed',
  'Yanıt hazırlanıyor': 'Preparing a response',
  'Yanıt hazır': 'Response is ready',
  'Yanıt üretilemedi': 'Could not generate a response',
  'Tamamlandı': 'Completed',
}

const systemCopy: Array<readonly [string, string]> = [
  ["Database and source storage", "Veritabanı ve kaynak depolaması"],
  ["Artifacts and indexing coverage", "Kaynaklar ve işleme kapsamı"],
  ["Structured memory freshness", "Hafızanın güncelliği"],
  ["Graph, signals, and temporal claims", "Bağlantılar ve değişiklikler"],
  ["Local/private LLM gateway", "Yapay zekâ hizmeti"],
  ["Queries, traces, and replay evidence", "Sorgular ve çalışma kayıtları"],
  ["Worker queue and orchestration jobs", "İş kuyruğu"],
  ["Repair missing artifact source files", "Eksik kaynak dosyalarını geri yükleyin"],
  ["Review pending artifacts", "Bekleyen kaynakları inceleyin"],
  ["Re-run ingestion for coverage gaps", "Eksik işlenen kaynakları yeniden işleyin"],
  ["Inspect worker queue", "İş kuyruğunu inceleyin"],
  ["Fix LLM gateway configuration", "Yapay zekâ bağlantısını düzeltin"],
  ["No immediate operator action required", "Şu anda işlem gerekmiyor"],
  ["The database still has artifact records, chunks, or memory, but at least one recorded source file is missing. Restore the mounted data directory or re-upload replacement artifacts before shipping.", "Kayıtlar mevcut ancak kaynak dosyası eksik. Veri dizinini geri yükleyin veya kaynağı yeniden yükleyin."],
  ["Submitted or needs-review artifacts can be visible, but they are not fully trusted. Review or reject them so institutional memory freshness is explicit.", "Bekleyen kaynakları inceleyip onaylayın veya reddedin."],
  ["Some completed artifacts have no chunks or no structured memory. Re-run ingestion and inspect fallback reasons.", "Bazı kaynakların işlenmesi eksik. Yeniden işleyin ve hata ayrıntılarını inceleyin."],
  ["Jobs are queued, retryable, or lease-expired. Confirm the worker daemon is running and then run the worker smoke gate.", "Bekleyen veya yeniden denenmesi gereken işler var. İşleyici hizmetini ve çalışma kayıtlarını kontrol edin."],
  ["Private inference features are enabled but the configured gateway/model is not ready. Check Ollama/model availability or disable feature flags intentionally.", "Yapay zekâ hizmeti hazır değil. Bağlantıyı ve modelin kullanılabilirliğini kontrol edin."],
  ["Current read-only checks did not find storage, indexing, queue, or LLM blockers. Keep running smoke/eval gates before deployment.", "Mevcut kontroller engelleyici sorun bulmadı. Yayın öncesi testler ayrıca yapılmalıdır."],
  ["SQLite, mounted storage roots, migration revision, and physical source-file integrity.", "Veritabanı ve kayıtlı kaynak dosyalarının bütünlüğü."],
  ["Lifecycle, trust review, chunk coverage, and structured-memory extraction coverage for stored artifacts.", "Kaynakların inceleme ve hafızaya işleme durumu."],
  ["Typed decisions, assumptions, constraints, outcomes, and commitments that the assistant can use independent of model strength.", "Asistanın kullanabildiği kararlar, varsayımlar, kısıtlar, sonuçlar ve taahhütler."],
  ["Evidence-backed links, claim families, active signals, and freshness warnings generated from memory objects.", "Kanıta dayalı ilişkiler, etkin sinyaller ve güncellik uyarıları."],
  ["Configured inference gateway, enabled feature flags, model availability, and deterministic fallback boundary.", "Model bağlantısı, kullanılabilir özellikler ve alternatif işleme durumu."],
  ["Stored query runs, trace packets, stage-run ledger rows, scenario replays, and ingestion jobs.", "Sorgu geçmişi, çalışma kayıtları ve tekrar incelenebilen senaryolar."],
  ["DB-backed bounded jobs, claim leases, idle/queued state, and recent worker outcomes.", "Bekleyen işler, işleyici durumu ve son çalışma sonuçları."],

  ['Launch acceleration or delay', 'Yayını hızlandırma veya erteleme'],
  ['Pricing or package change', 'Fiyatlandırma veya paket değişikliği'],
  ['Platform migration or architecture change', 'Platform geçişi veya mimari değişiklik'],
  ['Compliance, security or audit requirement', 'Uyumluluk, güvenlik veya denetim gereksinimi'],
  ['Organisation, ownership or staffing change', 'Organizasyon, sorumluluk veya kadro değişikliği'],
  ['What changes if we accelerate the enterprise onboarding launch?', 'Kurumsal müşteri devreye alımını hızlandırırsak ne değişir?'],
  ['What memory is affected if we introduce a new enterprise tier?', 'Yeni bir kurumsal paket oluşturursak hangi hafıza kayıtları etkilenir?'],
  ['Which existing constraints or decisions should be reviewed before migrating the memory store to a managed database?', 'Hafıza deposunu yönetilen veritabanına taşımadan önce hangi kısıtları veya kararları incelemeliyiz?'],
  ['What memory is affected if security approval is required before launch?', 'Yayın öncesi güvenlik onayı gerekirse hangi hafıza kayıtları etkilenir?'],
  ['Which commitments are affected if ownership moves to growth?', 'Sorumluluk büyüme ekibine geçerse hangi taahhütler etkilenir?'],
]

export function formatSystemText(value: string): string {
  const copy = systemCopy.find(([en, tr]) => en === value || tr === value)
  if (copy) return translate(copy[0], copy[1])
  if (getLanguage() !== 'en') return value
  if (systemStages[value]) return systemStages[value]
  const suffix = ' hafızaya işleniyor'
  return value.endsWith(suffix) ? `Adding ${value.slice(0, -suffix.length)} to memory` : value
}

import { translate } from '../lib/language'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { getCanonicalWorkspacePrompt } from '../lib/workspacePrompts'
import { formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { ArtifactRead, AssumptionDriftItem, ContradictionItem, GraphSummary, NextActionSignalItem, SignalRead } from '../lib/types'
import { useLanguage } from '../lib/i18n'

type DashboardSignalTone = 'critical' | 'drift' | 'action' | 'neutral'

interface DashboardSignalRow {
  id: string
  type: string
  title: string
  summary: string
  detail: string
  tone: DashboardSignalTone
  to?: string
  fullTitle?: string
  fullSummary?: string
}

function signalTone(signalType: string): DashboardSignalTone {
  if (signalType === 'contradiction') {
    return 'critical'
  }
  if (signalType === 'assumption_drift') {
    return 'drift'
  }
  if (signalType === 'next_action' || signalType === 'continuity_overlap') {
    return 'action'
  }
  return 'neutral'
}

function decisionRowClass(tone: DashboardSignalTone): string {
  return `decision-row decision-row-${tone}`
}

const DASHBOARD_COPY_REPLACEMENTS: Array<[RegExp, string]> = [
  [
    /we decided to keep the self-serve launch decision gate open until security and activation instrumentation evidence can be compared/gi,
    'launch gate stays open',
  ],
  [
    /move the self-serve onboarding launch target to Q3 2026 and prioritize foundation work first/gi,
    'move launch to Q3 2026',
  ],
  [/security and activation instrumentation evidence/gi, 'security + activation evidence'],
]

function compactDashboardCopy(value: string | null | undefined, maxLength = 112): string {
  if (!value) {
    return ''
  }

  let copy = value.replace(/\s+/g, ' ').trim()
  for (const [pattern, replacement] of DASHBOARD_COPY_REPLACEMENTS) {
    copy = copy.replace(pattern, replacement)
  }
  copy = copy.replace(/^Resolve contradiction:\s*launch gate stays open\s*↔\s*move launch to Q3 2026$/i, 'Resolve launch timing: gate open ↔ Q3 2026')

  if (copy.length <= maxLength) {
    return copy
  }

  return `${copy.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
}

function hasNoDashboardData(
  summary: GraphSummary | null,
  artifacts: ArtifactRead[],
  persistedSignals: SignalRead[],
  nextActions: NextActionSignalItem[],
): boolean {
  return !summary && artifacts.length === 0 && persistedSignals.length === 0 && nextActions.length === 0
}

export function DashboardPage() {
  const { t } = useLanguage()
  const { session } = useAuth()
  const [summary, setSummary] = useState<GraphSummary | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactRead[]>([])
  const [contradictions, setContradictions] = useState<ContradictionItem[]>([])
  const [assumptionDrift, setAssumptionDrift] = useState<AssumptionDriftItem[]>([])
  const [nextActions, setNextActions] = useState<NextActionSignalItem[]>([])
  const [persistedSignals, setPersistedSignals] = useState<SignalRead[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const [graphSummary, artifactList, contradictionList, driftList, actionList, signalList] = await Promise.all([
          api.getGraphSummary(session.token),
          api.listArtifacts(session.token),
          api.listContradictions(session.token),
          api.listAssumptionDrift(session.token),
          api.listNextActions(session.token),
          api.listSignals(session.token),
        ])

        if (!cancelled) {
          setSummary(graphSummary)
          setArtifacts(artifactList)
          setContradictions(contradictionList)
          setAssumptionDrift(driftList)
          setNextActions(actionList)
          setPersistedSignals(signalList)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load dashboard state.', 'Gösterge paneli durumu yüklenemedi.'))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [session?.token, t])

  const totalMemoryObjects = useMemo(
    () => Object.values(summary?.memory_counts ?? {}).reduce((total, count) => total + count, 0),
    [summary],
  )
  const persistedSignalCount = useMemo(
    () => Object.values(summary?.signal_counts ?? {}).reduce((total, count) => total + count, 0),
    [summary],
  )
  const isAdmin = session?.user.role === 'Admin'
  const isInitialLoad = isLoading && hasNoDashboardData(summary, artifacts, persistedSignals, nextActions)
  const reviewQueue = useMemo(
    () => artifacts.filter((artifact) => artifact.review_status === 'submitted' || artifact.review_status === 'needs_review'),
    [artifacts],
  )
  const reviewedArtifactCount = useMemo(() => artifacts.filter((artifact) => artifact.review_status === 'reviewed').length, [artifacts])
  const rejectedArtifactCount = useMemo(() => artifacts.filter((artifact) => artifact.review_status === 'rejected').length, [artifacts])
  const topPersistedSignal = persistedSignals[0] ?? null
  const latestCompletedArtifact =
    artifacts.find((artifact) => artifact.ingestion_status === 'completed' && artifact.review_status !== 'rejected') ??
    artifacts.find((artifact) => artifact.review_status !== 'rejected') ??
    artifacts[0] ??
    null
  const artifactCount = summary?.artifact_count ?? artifacts.length
  const reviewedRatio = artifactCount > 0 ? reviewedArtifactCount / artifactCount : 0

  const workspaceReadiness = useMemo(() => {
    if (isInitialLoad) {
      return {
        status: t('Loading', 'Yükleniyor'),
        title: t('Loading workspace state', 'Çalışma alanı durumu yükleniyor'),
        detail: t('Checking sources, memory, review state, and current signals.', 'Kaynaklar, hafıza, inceleme durumu ve mevcut sinyaller kontrol ediliyor.'),
        actionLabel: t('Open memory', 'Hafızayı aç'),
        actionTo: '/memory',
      }
    }
    if (!latestCompletedArtifact) {
      return {
        status: t('Needs source', 'Kaynak gerekli'),
        title: t('Load memory sources first', 'Önce hafıza kaynaklarını yükleyin'),
        detail: t('Operational use starts only after real company artifacts exist in this workspace.', 'Operasyonel kullanım, bu çalışma alanında gerçek şirket kaynakları bulunduktan sonra başlar.'),
        actionLabel: t('Open memory', 'Hafızayı aç'),
        actionTo: '/memory',
      }
    }
    if (!totalMemoryObjects) {
      return {
        status: t('Needs memory', 'Hafıza gerekli'),
        title: t('Run ingestion before reasoning', 'Akıl yürütmeden önce kaynakları işleyin'),
        detail: t('Artifacts exist, but reconstructed memory objects are required before answers are credible.', 'Kaynaklar var ancak güvenilir yanıtlar için yeniden oluşturulmuş hafıza nesneleri gerekir.'),
        actionLabel: t('Build memory', 'Hafıza oluştur'),
        actionTo: '/ingestion',
      }
    }
    if (isAdmin && reviewQueue.length > 0) {
      return {
        status: t('Needs review', 'İnceleme gerekli'),
        title: t('Review source trust before relying on answers', 'Yanıtlara güvenmeden önce kaynak güvenini inceleyin'),
        detail: t(`${reviewQueue.length} artifact(s) are waiting for an admin trust decision.`, `${reviewQueue.length} kaynak yönetici güven kararı bekliyor.`),
        actionLabel: t('Open review queue', 'İnceleme kuyruğunu aç'),
        actionTo: '/admin',
      }
    }
    if (!topPersistedSignal) {
      return {
        status: t('Needs signal', 'Sinyal gerekli'),
        title: t('Generate a durable signal', 'Kalıcı bir sinyal oluştur'),
        detail: translate("Memory exists; persist a contradiction, drift, supersession, or next-action signal to make the workflow actionable.", "Hafıza mevcut; iş akışını harekete geçirmek için çelişki, değişim, güncellenen karar veya sonraki iş sinyali oluşturun."),
        actionLabel: t('Inspect graph', 'Grafiği incele'),
        actionTo: '/graph',
      }
    }
    return {
      status: t('Ready', 'Hazır'),
      title: t('Ready for a grounded question', 'Kaynaklı bir soru için hazır'),
      detail: t('Source, reconstructed memory, review state, and durable signals are present.', 'Kaynak, yeniden oluşturulan hafıza, inceleme durumu ve kalıcı sinyaller mevcut.'),
      actionLabel: t('Ask workspace question', 'Çalışma alanına soru sor'),
      actionTo: `/query?prompt=${encodeURIComponent(getCanonicalWorkspacePrompt())}`,
    }
  }, [isAdmin, isInitialLoad, latestCompletedArtifact, reviewQueue.length, t, topPersistedSignal, totalMemoryObjects])

  const dashboardStats = useMemo(
    () => [
      {
        label: t('Sources', 'Kaynaklar'),
        value: isInitialLoad ? '—' : artifactCount,
        detail: isInitialLoad ? t('Checking source inventory', 'Kaynak envanteri kontrol ediliyor') : t(`${reviewQueue.length} awaiting review`, `${reviewQueue.length} inceleme bekliyor`),
      },
      {
        label: t('Memory objects', 'Hafıza nesneleri'),
        value: isInitialLoad ? '—' : totalMemoryObjects,
        detail: isInitialLoad ? t('Checking reconstructed memory', 'Yeniden oluşturulan hafıza kontrol ediliyor') : t('Structured decisions, assumptions, constraints, outcomes, and commitments', 'Yapılandırılmış kararlar, varsayımlar, kısıtlar, sonuçlar ve taahhütler'),
      },
      {
        label: t('Signals', 'Sinyaller'),
        value: isInitialLoad ? '—' : persistedSignalCount || nextActions.length,
        detail: isInitialLoad ? t('Checking active tensions', 'Etkin gerilimler kontrol ediliyor') : t(`${contradictions.length + assumptionDrift.length} active tensions`, `${contradictions.length + assumptionDrift.length} etkin gerilim`),
      },
      {
        label: t('Review coverage', 'İnceleme kapsamı'),
        value: isInitialLoad ? '—' : artifactCount > 0 ? formatPercent(reviewedRatio) : '0%',
        detail: isInitialLoad ? t('Checking review state', 'İnceleme durumu kontrol ediliyor') : t(`${reviewedArtifactCount} reviewed / ${rejectedArtifactCount} rejected`, `${reviewedArtifactCount} incelenen / ${rejectedArtifactCount} reddedilen`),
      },
    ],
    [
      artifactCount,
      assumptionDrift.length,
      contradictions.length,
      isInitialLoad,
      nextActions.length,
      persistedSignalCount,
      rejectedArtifactCount,
      reviewQueue.length,
      reviewedArtifactCount,
      reviewedRatio,
      t,
      totalMemoryObjects,
    ],
  )

  const workflowSteps = useMemo(
    () => [
      {
        step: '01',
        label: t('Capture', 'Kaydet'),
        title: latestCompletedArtifact?.title ?? t('Load company memory', 'Şirket hafızasını yükle'),
        detail: latestCompletedArtifact
          ? `${latestCompletedArtifact.artifact_id} · ${formatLabel(latestCompletedArtifact.ingestion_status)} · ${formatLabel(latestCompletedArtifact.review_status)}.`
          : t('Upload files or paste source text before relying on company memory.', 'Şirket hafızasına güvenmeden önce dosya yükleyin veya kaynak metni yapıştırın.'),
        status: latestCompletedArtifact ? formatLabel(latestCompletedArtifact.review_status) : t('Start here', 'Buradan başlayın'),
        to: '/memory',
      },
      {
        step: '02',
        label: t('Build', 'Oluştur'),
        title: t(`${totalMemoryObjects} reconstructed memory objects`, `${totalMemoryObjects} yeniden oluşturulan hafıza nesnesi`),
        detail: t('Ingestion extracts decisions, assumptions, constraints, outcomes, commitments, provenance, and graph links.', 'İşleme; kararları, varsayımları, kısıtları, sonuçları, taahhütleri, kaynakları ve grafik bağlantılarını çıkarır.'),
        status: totalMemoryObjects > 0 ? t('Built', 'Oluşturuldu') : t('Pending', 'Bekliyor'),
        to: '/ingestion',
      },
      {
        step: '03',
        label: t('Govern', 'Yönet'),
        title: isAdmin ? t(`${reviewQueue.length} source item(s) need review`, `${reviewQueue.length} kaynak inceleme gerektiriyor`) : t('Source trust state is visible', 'Kaynak güven durumu görünür'),
        detail: t('Review status is part of the reasoning record so unsupported or rejected material stays traceable.', 'İnceleme durumu akıl yürütme kaydının parçasıdır; desteklenmeyen veya reddedilen içerik izlenebilir kalır.'),
        status: reviewQueue.length > 0 ? t('Needs review', 'İnceleme gerekli') : t('Clear', 'Temiz'),
        to: isAdmin ? '/admin' : '/audit',
      },
      {
        step: '04',
        label: t('Use', 'Kullan'),
        title: topPersistedSignal ? compactDashboardCopy(topPersistedSignal.title, 78) : t('Ask an evidence-backed question', 'Kanıt destekli bir soru sorun'),
        detail: topPersistedSignal
          ? compactDashboardCopy(topPersistedSignal.summary || t('Open the newest persisted signal or ask the canonical workspace question.', 'En yeni kayıtlı sinyali açın veya çalışma alanı sorusunu sorun.'), 118)
          : getCanonicalWorkspacePrompt(),
        status: topPersistedSignal ? formatLabel(topPersistedSignal.signal_type) : t('Question', 'Soru'),
        to: topPersistedSignal ? `/signals/${topPersistedSignal.signal_id}` : `/query?prompt=${encodeURIComponent(getCanonicalWorkspacePrompt())}`,
      },
    ],
    [isAdmin, latestCompletedArtifact, reviewQueue.length, t, topPersistedSignal, totalMemoryObjects],
  )

  const signalRows = useMemo<DashboardSignalRow[]>(() => {
    const rows: DashboardSignalRow[] = [
      ...persistedSignals.slice(0, 4).map((signal) => ({
        id: signal.signal_id,
        type: `Persisted ${formatLabel(signal.signal_type)}`,
        title: compactDashboardCopy(signal.title, 92),
        summary: compactDashboardCopy(signal.summary, 142),
        detail: compactDashboardCopy(
          `${signal.source_artifact_title ?? signal.source_artifact_id ?? translate("Unknown source", "Bilinmeyen kaynak")} · ${t('urgency', 'aciliyet')} ${formatPercent(signal.urgency_score)} · ${formatDateTime(signal.created_at)}`,
          128,
        ),
        tone: signalTone(signal.signal_type),
        to: `/signals/${signal.signal_id}`,
        fullTitle: signal.title,
        fullSummary: signal.summary,
      })),
      ...contradictions.slice(0, 2).map((item) => {
        const fullTitle = `${item.from_title} ↔ ${item.to_title}`
        const fullSummary = item.evidence_provenance ?? t('Two pieces of memory conflict and require a decision.', 'İki hafıza kaydı çelişiyor ve karar gerektiriyor.')
        return {
          id: item.edge_id,
          type: t('Contradiction', 'Çelişki'),
          title: compactDashboardCopy(fullTitle, 92),
          summary: compactDashboardCopy(fullSummary, 142),
          detail: t(`Topic ${item.topic_key} · confidence ${formatPercent(item.confidence_score)}`, `Konu ${item.topic_key} · güven ${formatPercent(item.confidence_score)}`),
          tone: 'critical' as const,
          fullTitle,
          fullSummary,
        }
      }),
      ...assumptionDrift.slice(0, 2).map((item) => {
        const fullSummary = item.validity_notes || item.evidence_provenance || t('Later evidence weakened this assumption.', 'Sonraki kanıt bu varsayımı zayıflattı.')
        return {
          id: item.assumption_id,
          type: t('Assumption drift', 'Varsayım değişimi'),
          title: compactDashboardCopy(item.title_or_label, 92),
          summary: compactDashboardCopy(fullSummary, 142),
          detail: t(`Status ${formatLabel(item.status)} · topic ${item.topic_key}`, `Durum ${formatLabel(item.status)} · konu ${item.topic_key}`),
          tone: 'drift' as const,
          fullTitle: item.title_or_label,
          fullSummary,
        }
      }),
      ...nextActions.slice(0, 2).map((item) => ({
        id: item.signal_id,
        type: t('Next action', 'Sonraki eylem'),
        title: compactDashboardCopy(item.title, 92),
        summary: compactDashboardCopy(item.recommended_action, 142),
        detail: t(`Urgency ${formatPercent(item.urgency_score)} · uncertainty ${formatPercent(item.uncertainty_score)}`, `Aciliyet ${formatPercent(item.urgency_score)} · belirsizlik ${formatPercent(item.uncertainty_score)}`),
        tone: 'action' as const,
        fullTitle: item.title,
        fullSummary: item.recommended_action,
      })),
    ]

    return rows.slice(0, 8)
  }, [assumptionDrift, contradictions, nextActions, persistedSignals, t])

  const accessibleArtifacts = useMemo(
    () => artifacts.filter((artifact) => artifact.review_status !== 'rejected'),
    [artifacts],
  )
  const employeeEvidenceRows = useMemo(() => accessibleArtifacts.slice(0, 5), [accessibleArtifacts])
  const employeeReadiness = useMemo(() => {
    if (isInitialLoad) {
      return {
        status: t('Loading', 'Yükleniyor'),
        title: t('Loading current focus', 'Mevcut odak yükleniyor'),
        detail: t('Checking your accessible sources, memory graph, and current signals.', 'Erişebildiğiniz kaynaklar, hafıza grafiği ve mevcut sinyaller kontrol ediliyor.'),
        to: '/memory',
        actionLabel: t('Open memory', 'Hafızayı aç'),
      }
    }
    if (!latestCompletedArtifact) {
      return {
        status: t('Needs source', 'Kaynak gerekli'),
        title: t('Add the first useful source', 'İlk yararlı kaynağı ekleyin'),
        detail: t('Upload or paste the company material you need Izge to reason over, then ask your question from the assistant.', 'İzge’nin değerlendirmesi gereken şirket içeriğini yükleyin veya yapıştırın, ardından asistana sorun.'),
        to: '/memory',
        actionLabel: t('Add source', 'Kaynak ekle'),
      }
    }
    if (!totalMemoryObjects) {
      return {
        status: t('Preparing memory', 'Hafıza hazırlanıyor'),
        title: t('Memory sources are present', 'Hafıza kaynakları mevcut'),
        detail: t('Sources exist in this workspace. An admin may need to finish processing before every answer has full memory context.', 'Bu çalışma alanında kaynaklar var. Her yanıt tam hafıza bağlamına ulaşmadan önce bir yöneticinin işlemeyi tamamlaması gerekebilir.'),
        to: '/memory',
        actionLabel: t('Open memory', 'Hafızayı aç'),
      }
    }
    if (signalRows.length > 0) {
      return {
        status: t('Action available', 'Eylem mevcut'),
        title: signalRows[0].title,
        detail: signalRows[0].summary,
        to: signalRows[0].to ?? '/graph',
        actionLabel: t('Open focus item', 'Odak öğesini aç'),
      }
    }
    return {
      status: t('Ready', 'Hazır'),
      title: t('Ready for a grounded question', 'Kaynaklı bir soru için hazır'),
      detail: t('Ask Izge about decisions, assumptions, next actions, or sources you are allowed to access.', 'İzge’ye erişebildiğiniz kararları, varsayımları, sonraki eylemleri veya kaynakları sorun.'),
      to: `/query?prompt=${encodeURIComponent(getCanonicalWorkspacePrompt())}`,
      actionLabel: t('Ask Izge', 'İzge’ye sor'),
    }
  }, [isInitialLoad, latestCompletedArtifact, signalRows, t, totalMemoryObjects])
  const employeeActions = useMemo(
    () => [
      {
        title: t('Ask Izge', 'İzge’ye sor'),
        detail: t('Ask questions grounded in your permitted artifacts.', 'İzinli kaynaklarınıza dayanan sorular sorun.'),
        meta: isInitialLoad
          ? t('Checking memory access', 'Hafıza erişimi kontrol ediliyor')
          : totalMemoryObjects > 0
            ? t(`${totalMemoryObjects} memory object${totalMemoryObjects === 1 ? '' : 's'} available`, `${totalMemoryObjects} hafıza nesnesi mevcut`)
            : t('Works best after evidence is processed', 'Kanıt işlendiğinde en iyi sonucu verir'),
        to: `/query?prompt=${encodeURIComponent(getCanonicalWorkspacePrompt())}`,
        cta: t('Ask now', 'Şimdi sor'),
        icon: '✦',
        primary: true,
      },
      {
        title: t('Continue team chat', 'Ekip sohbetine devam et'),
        detail: t('Message coworkers without leaving the workspace.', 'Çalışma alanından ayrılmadan ekip arkadaşlarınıza mesaj gönderin.'),
        meta: t('Company conversations stay in context', 'Şirket konuşmaları bağlamda kalır'),
        to: '/team-chat',
        cta: t('Open chat', 'Sohbeti aç'),
        icon: '◌',
        primary: false,
      },
      {
        title: t('Open memory', 'Hafızayı aç'),
        detail: t('Preview accessible sources and check their status.', 'Erişilebilir kaynakları önizleyin ve durumlarını kontrol edin.'),
        meta: isInitialLoad ? t('Checking source access', 'Kaynak erişimi kontrol ediliyor') : t(`${accessibleArtifacts.length} accessible source${accessibleArtifacts.length === 1 ? '' : 's'}`, `${accessibleArtifacts.length} erişilebilir kaynak`),
        to: '/memory',
        cta: t('View memory', 'Hafızayı görüntüle'),
        icon: '□',
        primary: false,
      },
      {
        title: t('Inspect graph', 'Grafiği incele'),
        detail: signalRows[0]?.title ?? (isInitialLoad ? t('Checking current signals.', 'Mevcut sinyaller kontrol ediliyor.') : t('Explore linked decisions, assumptions, and evidence.', 'Bağlantılı kararları, varsayımları ve kanıtları keşfedin.')),
        meta: signalRows.length > 0 ? t(`${signalRows.length} focus item${signalRows.length === 1 ? '' : 's'}`, `${signalRows.length} odak kaydı`) : isInitialLoad ? t('Checking signals', 'Sinyaller kontrol ediliyor') : t('No urgent signals yet', 'Henüz acil sinyal yok'),
        to: signalRows[0]?.to ?? '/graph',
        cta: signalRows.length > 0 ? t('Review signal', 'Sinyali incele') : t('Open graph', 'Grafiği aç'),
        icon: '◇',
        primary: false,
      },
    ],
    [accessibleArtifacts.length, isInitialLoad, signalRows, t, totalMemoryObjects],
  )

  const memoryComposition = useMemo(
    () => Object.entries(summary?.memory_counts ?? {}).sort(([, firstCount], [, secondCount]) => secondCount - firstCount),
    [summary],
  )

  if (!isAdmin) {
    return (
      <div className="stack-xl employee-home-page">
        <section className="employee-hero" aria-labelledby="employee-home-title">
          <div className="employee-hero-copy">
            <p className="eyebrow">{t('Employee workspace', 'Çalışan alanı')}</p>
            <h1 id="employee-home-title" className="brand-title">{t("Get work done with company memory.", "Şirket hafızasıyla işlerinizi tamamlayın.")}</h1>
            <p className="page-description">{t("Ask, check evidence, or message coworkers. Izge uses only the artifacts you are allowed to access.", "Soru sorun, kaynakları inceleyin veya çalışma arkadaşlarınıza yazın. İzge yalnız erişim izniniz olan kaynakları kullanır.")}</p>
            <div className="employee-hero-actions">
              <Link className="primary-button" to={`/query?prompt=${encodeURIComponent(getCanonicalWorkspacePrompt())}`}>{t("Ask Izge", "İzge’ye sor")}</Link>
              <Link className="secondary-button" to="/team-chat">{t("Team chat", "Ekip sohbeti")}</Link>
            </div>
          </div>

          <aside className="employee-focus-panel" aria-label={t('Current focus', 'Mevcut odak')}>
            <div className="employee-focus-header">
              <div>
                <p className="section-label">{t('Current focus', 'Mevcut odak')}</p>
                <p className="table-primary">{employeeReadiness.title}</p>
              </div>
              <StatusBadge value={employeeReadiness.status} />
            </div>
            <details className="employee-focus-details">
              <summary>{t('Details', 'Ayrıntılar')}</summary>
              <p className="muted-copy">{employeeReadiness.detail}</p>
            </details>
            <Link className="secondary-button" to={employeeReadiness.to}>
              {employeeReadiness.actionLabel}
            </Link>
            <dl className="employee-context-list">
              <div>
                <dt>{t('Signed in as', 'Oturum açan')}</dt>
                <dd>{session?.user.display_name ?? t('Employee', 'Çalışan')}</dd>
              </div>
              <div>
                <dt>{t('Access rule', 'Erişim kuralı')}</dt>
                <dd>{t('Your answers use only permitted company memory.', 'Yanıtlarınız yalnızca izinli şirket hafızasını kullanır.')}</dd>
              </div>
            </dl>
          </aside>
        </section>

        {error ? <Callout tone="warning">{error}</Callout> : null}

        <section className="employee-action-grid" aria-label={t('Primary employee actions', 'Temel çalışan eylemleri')}>
          {employeeActions.map((action) => (
            <Link key={action.title} className={action.primary ? 'employee-action-card employee-action-card-primary' : 'employee-action-card'} to={action.to}>
              <span className="employee-action-icon" aria-hidden="true">
                {action.icon}
              </span>
              <span className="employee-action-copy">
                <span className="table-primary">{action.title}</span>
                <span className="muted-copy">{action.detail}</span>
                <span className="table-secondary">{action.meta}</span>
              </span>
              <span className="employee-action-cta">{action.cta}</span>
            </Link>
          ))}
        </section>

        <div className="employee-content-grid">
          <Panel
            title={t('Work queue', 'İş kuyruğu')}
            description={t('Current signals that need attention.', 'Dikkat gerektiren mevcut sinyaller.')}
            aside={
              <Link className="secondary-button" to="/graph">{t("Open graph", "Grafiği aç")}</Link>
            }
          >
            {isLoading ? <p className="muted-copy">{t('Loading your workspace…', 'Çalışma alanınız yükleniyor…')}</p> : null}
            {!isLoading && signalRows.length === 0 ? (
              <EmptyState
                title={t('No active focus items', 'Etkin odak öğesi yok')}
                description={t('Signals appear here when accessible evidence needs action.', 'Erişilebilir kanıt eylem gerektirdiğinde sinyaller burada görünür.')}
              />
            ) : null}
            {signalRows.length > 0 ? (
              <div className="employee-work-list">
                {signalRows.slice(0, 5).map((row) => (
                  <Link
                    key={row.id}
                    className={`employee-work-item employee-work-item-${row.tone}`}
                    to={row.to ?? '/graph'}
                    title={`${row.fullTitle ?? row.title}. ${row.fullSummary ?? row.summary}. ${row.detail}`}
                  >
                    <span className="employee-work-kind">{row.type}</span>
                    <span className="employee-work-copy">
                      <span className="table-primary">{row.title}</span>
                      <span className="muted-copy">{row.summary}</span>
                      <span className="table-secondary">{row.detail}</span>
                    </span>
                    <span className="employee-work-arrow" aria-hidden="true">
                      ↗
                    </span>
                  </Link>
                ))}
              </div>
            ) : null}
          </Panel>

          <Panel
            title={t('Recent memory sources', 'Son hafıza kaynakları')}
            description={t('Accessible company sources.', 'Erişilebilir şirket kaynakları.')}
            aside={
              <Link className="secondary-button" to="/memory">{t("View all", "Tümünü gör")}</Link>
            }
          >
            {isLoading ? <p className="muted-copy">{t('Loading memory…', 'Hafıza yükleniyor…')}</p> : null}
            {!isLoading && employeeEvidenceRows.length === 0 ? (
              <EmptyState title={t('No accessible sources yet', 'Henüz erişilebilir kaynak yok')} description={t('Add source material or ask an admin to grant access.', 'Kaynak ekleyin veya erişim için bir yöneticiye başvurun.')} />
            ) : null}
            {employeeEvidenceRows.length > 0 ? (
              <div className="table-wrap employee-evidence-table-wrap">
                <table className="data-table employee-evidence-table">
                  <thead>
                    <tr>
                      <th>{t('Source', 'Kaynak')}</th>
                      <th>{t('Status', 'Durum')}</th>
                      <th>{t('Updated', 'Güncellendi')}</th>
                      <th>{t('Action', 'Eylem')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employeeEvidenceRows.map((artifact) => (
                      <tr key={artifact.artifact_id}>
                        <td>
                          <div>
                            <p className="table-primary">{artifact.title}</p>
                            <p className="table-secondary">{artifact.original_filename ?? formatLabel(artifact.source_type)}</p>
                          </div>
                        </td>
                        <td>
                          <StatusBadge value={artifact.ingestion_status} />
                        </td>
                        <td>{formatDateTime(artifact.updated_at)}</td>
                        <td>
                          <Link className="text-button" to="/memory">{t("Open", "Aç")}</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    )
  }

  const reasoningModes = [
    [t('Decision lineage', 'Karar geçmişi'), t('Understand why a decision exists', 'Bir kararın neden var olduğunu anlayın'), t('Timeline, owner, evidence, and related commitments', 'Zaman çizelgesi, sorumlu, kanıt ve ilgili taahhütler')],
    [t('Contradiction analysis', 'Çelişki analizi'), t('Resolve conflicting claims', 'Çelişen ifadeleri çözün'), t('Conflicting memory objects with provenance and confidence', 'Kaynağı ve güven düzeyiyle çelişen hafıza nesneleri')],
    [t('Assumption drift', 'Varsayım değişimi'), t('Find stale operating assumptions', 'Eski işletme varsayımlarını bulun'), t('Assumptions whose validity changed after later evidence', 'Sonraki kanıtlarla geçerliliği değişen varsayımlar')],
    [t('Next-action guidance', 'Sonraki eylem yönlendirmesi'), t('Move from evidence to work', 'Kanıttan eyleme geçin'), t('Recommended action with urgency, uncertainty, and supporting facts', 'Aciliyet, belirsizlik ve destekleyici olgularla önerilen eylem')],
  ]

  return (
    <div className="stack-xl dashboard-page">
      <section className="dashboard-hero" aria-labelledby="dashboard-title">
        <div className="dashboard-hero-copy">
          <p className="eyebrow">{t('Operations dashboard', 'Operasyon gösterge paneli')}</p>
          <h1 id="dashboard-title" className="brand-title">{t("Company memory control center", "Şirket hafızası kontrol merkezi")}</h1>
          <p className="page-description">{t("A practical operating view for source intake, evidence governance, memory reconstruction, signal review, and grounded answers.", "Kaynak ekleme, kanıt yönetimi, hafızayı yeniden oluşturma, sinyal inceleme ve kaynaklı yanıtlar için operasyon görünümü.")}</p>
          <div className="inline-actions">
            <Link className="primary-button" to={workspaceReadiness.actionTo}>
              {workspaceReadiness.actionLabel}
            </Link>
          </div>
        </div>

        <aside className="dashboard-hero-panel" aria-label={t('Current readiness and workspace boundary', 'Mevcut hazırlık ve çalışma alanı sınırı')}>
          <div className="readiness-header">
            <div>
              <p className="section-label">{t('Current state', 'Mevcut durum')}</p>
              <p className="table-primary">{workspaceReadiness.title}</p>
            </div>
            <StatusBadge value={workspaceReadiness.status} />
          </div>
          <p className="muted-copy">{workspaceReadiness.detail}</p>
          <dl className="dashboard-meta-list">
            <div>
              <dt>{t('User', 'Kullanıcı')}</dt>
              <dd>{session?.user.display_name ?? t('Unavailable', 'Kullanılamıyor')}</dd>
            </div>
            <div>
              <dt>{t('Role', 'Rol')}</dt>
              <dd>{session?.user.role ?? t('Unavailable', 'Kullanılamıyor')}</dd>
            </div>
            <div>
              <dt>{t('Workspace', 'Çalışma alanı')}</dt>
              <dd>{summary?.workspace_id ?? session?.user.workspace_id ?? t('Unavailable', 'Kullanılamıyor')}</dd>
            </div>
            <div>
              <dt>{t('Stance', 'Yaklaşım')}</dt>
              <dd>{t('Reconstruct first. Compare second. Recommend last.', 'Önce yeniden kur. Sonra karşılaştır. En son öner.')}</dd>
            </div>
          </dl>
        </aside>
      </section>

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <section className="dashboard-kpi-strip" aria-label={t('Current workspace health', 'Mevcut çalışma alanı sağlığı')}>
        {dashboardStats.map((metric) => (
          <article key={metric.label} className="dashboard-kpi">
            <p className="section-label">{metric.label}</p>
            <p className="dashboard-kpi-value">{metric.value}</p>
            <p className="table-secondary">{metric.detail}</p>
          </article>
        ))}
      </section>

      <div className="dashboard-main-grid">
        <Panel
          title={t('Operating path', 'Çalışma yolu')}
          description={t('The next operational step should be clear without forcing employees through many similar cards.', 'Sonraki operasyonel adım, çalışanları benzer kartlara boğmadan açık olmalıdır.')}
          aside={
            <Link className="secondary-button" to={workspaceReadiness.actionTo}>{t("Continue", "Devam et")}</Link>
          }
        >
          <ol className="workflow-step-list">
            {workflowSteps.map((step) => (
              <li key={step.step} className="workflow-step">
                <span className="workflow-step-index">{step.step}</span>
                <div className="workflow-step-copy">
                  <div className="workflow-step-head">
                    <div>
                      <p className="section-label">{step.label}</p>
                      <p className="table-primary">{step.title}</p>
                    </div>
                    <StatusBadge value={step.status} />
                  </div>
                  <p className="muted-copy">{step.detail}</p>
                </div>
                <Link className="text-button" to={step.to}>{t("Open", "Aç")}</Link>
              </li>
            ))}
          </ol>
        </Panel>

        {isAdmin ? (
          <Panel
            title={t('Evidence governance', 'Kanıt yönetimi')}
            description={t('Trusted answers depend on an explicit source review state. Stored records remain auditable even when rejected.', 'Güvenilir yanıtlar açık bir kaynak inceleme durumuna bağlıdır. Reddedilen kayıtlar da denetlenebilir kalır.')}
            aside={
              <Link className="secondary-button" to="/admin/users">{t("Manage", "Yönet")}</Link>
            }
          >
            <dl className="review-ledger">
              <div>
                <dt>{t('Waiting', 'Bekliyor')}</dt>
                <dd>{reviewQueue.length}</dd>
              </div>
              <div>
                <dt>{t('Reviewed', 'İncelendi')}</dt>
                <dd>{reviewedArtifactCount}</dd>
              </div>
              <div>
                <dt>{t('Rejected', 'Reddedildi')}</dt>
                <dd>{rejectedArtifactCount}</dd>
              </div>
            </dl>
            {reviewQueue.length > 0 ? (
              <div className="review-queue-list">
                {reviewQueue.slice(0, 4).map((artifact) => (
                  <Link key={artifact.artifact_id} className="review-queue-row" to="/admin/users">
                    <div>
                      <p className="table-primary">{artifact.title}</p>
                      <p className="table-secondary">
                        {formatLabel(artifact.ingestion_status)}{t(" · updated ", " · güncellendi ")}{formatDateTime(artifact.updated_at)}
                      </p>
                    </div>
                    <StatusBadge value={artifact.review_status} />
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted-copy">{t('No submitted or needs-review sources are waiting in the admin queue.', 'Yönetici kuyruğunda gönderilmiş veya inceleme bekleyen kaynak yok.')}</p>
            )}
          </Panel>
        ) : (
          <Panel title={t('Evidence boundary', 'Kanıt sınırı')} description={t('Permissions and trust state remain part of every answer.', 'İzinler ve güven durumu her yanıtın parçası kalır.')}>
            <p className="muted-copy">{t("You are viewing the workspace as", "Çalışma alanını şu kullanıcı olarak görüntülüyorsunuz:")}{session?.user.display_name ?? translate("the current user", "mevcut kullanıcı")}{t(". Restricted evidence stays out of answers when permissions do not allow it.", ". Erişim izni olmayan kaynaklar yanıtlara dahil edilmez.")}</p>
          </Panel>
        )}
      </div>

      <div className="dashboard-analysis-grid">
        <Panel title={t('Reasoning modes', 'Akıl yürütme modları')} description={t('Modes are operational tools, not marketing copy or chat personas.', 'Modlar pazarlama metni veya sohbet karakteri değil, operasyonel araçlardır.')}>
          <div className="table-wrap mode-table-wrap">
            <table className="data-table mode-table">
              <thead>
                <tr>
                  <th>{t('Mode', 'Mod')}</th>
                  <th>{t('Use when', 'Ne zaman kullanılır')}</th>
                  <th>{t('Output', 'Çıktı')}</th>
                </tr>
              </thead>
              <tbody>
                {reasoningModes.map(([mode, useWhen, output]) => (
                  <tr key={mode}>
                    <td>{mode}</td>
                    <td>{useWhen}</td>
                    <td>{output}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={t('Memory composition', 'Hafıza bileşimi')} description={t('A compact graph of what processing reconstructed from company sources.', 'İşlemenin şirket kaynaklarından yeniden kurduğu bilgilerin küçük grafiği.')}>
          {memoryComposition.length === 0 ? (
            <EmptyState title={t('No memory graph yet', 'Henüz hafıza grafiği yok')} description={t('Process sources to populate the memory composition graph.', 'Hafıza bileşimi grafiğini doldurmak için kaynakları işleyin.')} />
          ) : (
            <div className="composition-chart" aria-label={t('Memory object composition', 'Hafıza nesnesi bileşimi')}>
              {memoryComposition.map(([memoryType, count]) => {
                const width = totalMemoryObjects > 0 ? Math.max(6, (count / totalMemoryObjects) * 100) : 0
                return (
                  <div key={memoryType} className="composition-row">
                    <span>{formatLabel(memoryType)}</span>
                    <span className="composition-track" aria-hidden="true">
                      <span style={{ width: `${width}%` }} />
                    </span>
                    <strong>{count}</strong>
                  </div>
                )
              })}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title={t('Signals requiring a decision', 'Karar gerektiren sinyaller')}
        description={t('Signals are shown as an action list so users can scan type, evidence, urgency, and destination quickly.', 'Sinyaller, kullanıcıların türü, kanıtı, aciliyeti ve hedefi hızla tarayabilmesi için eylem listesi olarak gösterilir.')}
        aside={
          <Link className="secondary-button" to="/graph">{t("Inspect graph", "Grafiği incele")}</Link>
        }
      >
        {signalRows.length === 0 ? (
          <EmptyState title={t('No active signals yet', 'Henüz etkin sinyal yok')} description={t('Process company sources to surface contradictions, drift, and grounded guidance.', 'Çelişkileri, değişimleri ve kaynaklı yönlendirmeyi bulmak için şirket kaynaklarını işleyin.')} />
        ) : (
          <div className="decision-list">
            {signalRows.map((row) => {
              const content = (
                <>
                  <div className="decision-row-kind">
                    <span>{row.type}</span>
                  </div>
                  <div className="decision-row-copy">
                    <p className="table-primary">{row.title}</p>
                    <p className="muted-copy">{row.summary}</p>
                    <p className="table-secondary">{row.detail}</p>
                  </div>
                  <span className="decision-row-arrow" aria-hidden="true">
                    {row.to ? '↗' : '•'}
                  </span>
                </>
              )

              return row.to ? (
                <Link key={row.id} className={decisionRowClass(row.tone)} to={row.to} title={`${row.fullTitle ?? row.title}. ${row.fullSummary ?? row.summary}. ${row.detail}`}>
                  {content}
                </Link>
              ) : (
                <article key={row.id} className={decisionRowClass(row.tone)} title={`${row.fullTitle ?? row.title}. ${row.fullSummary ?? row.summary}. ${row.detail}`}>
                  {content}
                </article>
              )
            })}
          </div>
        )}
      </Panel>

      <Panel
        title={t('Recent memory sources entering memory', 'Hafızaya giren son kaynaklar')}
        description={t('Sources are inspectable provenance, not background files.', 'Kaynaklar arka plandaki dosyalar değil, incelenebilir dayanaklardır.')}
        aside={
          <Link className="secondary-button" to="/memory">{t("View all", "Tümünü gör")}</Link>
        }
      >
        {isLoading ? <p className="muted-copy">{t('Loading source inventory…', 'Kaynak envanteri yükleniyor…')}</p> : null}
        {!isLoading && artifacts.length === 0 ? (
          <EmptyState title={t('No sources yet', 'Henüz kaynak yok')} description={t('Upload a file or paste text to start reconstructing institutional memory.', 'Kurumsal hafızayı yeniden oluşturmaya başlamak için dosya yükleyin veya metin yapıştırın.')} />
        ) : null}
        {artifacts.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('Source', 'Kaynak')}</th>
                  <th>{t('Visibility', 'Görünürlük')}</th>
                  <th>{t('Status', 'Durum')}</th>
                  <th>{t('Review', 'İnceleme')}</th>
                  <th>{t('Updated', 'Güncellendi')}</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.slice(0, 6).map((artifact) => (
                  <tr key={artifact.artifact_id}>
                    <td>
                      <div>
                        <p className="table-primary">{artifact.title}</p>
                        <p className="table-secondary">{artifact.artifact_id}</p>
                      </div>
                    </td>
                    <td>{artifact.visibility_scope}</td>
                    <td>
                      <StatusBadge value={artifact.ingestion_status} />
                    </td>
                    <td>
                      <StatusBadge value={artifact.review_status} />
                    </td>
                    <td>{formatDateTime(artifact.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>
    </div>
  )
}

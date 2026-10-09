import { translate } from '../lib/language'
import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDate, formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { QueryResult, QueryTraceRead, QueryTraceStepRead } from '../lib/types'
import { useLanguage } from '../lib/i18n'

function readRecordField(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value : 'Unavailable'
}

function readStringArray(record: Record<string, unknown>, field: string): string[] {
  const value = record[field]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readRecordArray(record: Record<string, unknown>, field: string): Array<Record<string, unknown>> {
  const value = record[field]
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : []
}

function readRecord(record: Record<string, unknown>, field: string): Record<string, unknown> | null {
  const value = record[field]
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function stepTitle(stepKind: string): string {
  switch (stepKind) {
    case 'route_decision':
      return 'Grounding'
    case 'seed_selection':
      return translate("Seed selection", "Başlangıç seçimi")
    case 'bounded_orchestration':
      return translate("Bounded orchestration", "Sınırlı iş akışı")
    case 'context_assembly':
      return translate("Typed context packet", "Yapılandırılmış bağlam paketi")
    case 'provenance_verification':
      return translate("Provenance verification", "Kaynak doğrulama")
    case 'evidence_selection':
      return translate("Evidence selection", "Kanıt seçimi")
    case 'answer_composition':
      return 'Synthesis'
    case 'uncertainty_note':
      return 'Uncertainty'
    default:
      return stepKind.replace(/_/g, ' ')
  }
}

function modePlainEnglish(queryClass: string): string {
  switch (queryClass) {
    case translate("Decision lineage", "Karar geçmişi"):
      return translate("Reconstruct the decision timeline before making any recommendation.", "Öneride bulunmadan önce karar zaman çizelgesini oluşturun.")
    case translate("Contradiction analysis", "Çelişki analizi"):
      return translate("Compare later claims against earlier commitments and surface the collision.", "Yeni iddiaları önceki taahhütlerle karşılaştırarak çelişkileri ortaya çıkarın.")
    case translate("Assumption drift", "Varsayım değişimi"):
      return translate("Find assumptions whose operating basis weakened, reversed, or went stale.", "Dayanağı zayıflayan, tersine dönen veya geçerliliğini yitiren varsayımları bulun.")
    case translate("Next-action guidance", "Sonraki iş önerisi"):
      return translate("Promote an action only after conflict, drift, commitments, and evidence are visible.", "Yalnız çelişkiler, değişimler, taahhütler ve kanıtlar görüldükten sonra iş önerin.")
    default:
      return translate("Route the question into a bounded institutional-memory operation.", "Soruyu sınırlı bir kurumsal hafıza işlemine yönlendirin.")
  }
}

function firstAvailable(...values: string[]): string {
  return values.find((value) => value && value !== 'Unavailable') ?? translate("No explicit signal returned.", "Belirgin bir sinyal dönmedi.")
}

function findTracePayload(trace: QueryTraceRead | null, stepKind: string): Record<string, unknown> | null {
  const step = trace?.steps.find((item) => item.step_kind === stepKind)
  return step?.payload ?? null
}

function routeSourceLabel(routeSource: string): string {
  switch (routeSource) {
    case 'local_llm_intent':
      return translate("Local LLM intent routing", "Yerel LLM niyet yönlendirmesi")
    case 'keyword_after_llm_fallback':
      return translate("Keyword routing after LLM fallback", "LLM sonrası anahtar sözcük yönlendirmesi")
    case 'keyword':
      return translate("Deterministic keyword routing", "Belirleyici anahtar sözcük yönlendirmesi")
    default:
      return formatLabel(routeSource)
  }
}

function synthesisStatusLabel(status: string): string {
  switch (status) {
    case 'applied':
      return translate("LLM-assisted answer wording", "LLM destekli yanıt metni")
    case 'fallback':
      return translate("Deterministic answer after LLM fallback", "LLM sonrası belirleyici yanıt")
    case 'disabled':
      return translate("Deterministic answer only", "Yalnız belirleyici yanıt")
    default:
      return formatLabel(status)
  }
}

export function QueryResultPage() {
  const { t } = useLanguage()
  const { queryRunId = '' } = useParams()
  const location = useLocation()
  const { session } = useAuth()
  const routedResult = (location.state as { result?: QueryResult } | null)?.result
  const [result, setResult] = useState<QueryResult | null>(routedResult ?? null)
  const [trace, setTrace] = useState<QueryTraceRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(!routedResult)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token || !queryRunId) {
        return
      }

      setIsLoading(true)
      setError(null)

      try {
        const [nextResult, nextTrace] = await Promise.all([
          routedResult?.query_run_id === queryRunId ? Promise.resolve(routedResult) : api.getQueryResult(session.token, queryRunId),
          api.getQueryTrace(session.token, queryRunId),
        ])
        if (!cancelled) {
          setResult(nextResult)
          setTrace(nextTrace)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load query result.', 'Sorgu sonucu yüklenemedi.'))
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
  }, [queryRunId, routedResult, session?.token, t])

  const activeResult = routedResult?.query_run_id === queryRunId ? routedResult : result
  const topContradiction = activeResult?.contradictions[0]
  const topDrift = activeResult?.stale_assumptions[0]
  const topAction = activeResult?.recommended_next_actions[0]
  const graphEvidenceCount = activeResult?.supporting_evidence.filter((item) => item.evidence_kind === 'graph').length ?? 0
  const routePayload = findTracePayload(trace, 'route_decision')
  const answerCompositionPayload = findTracePayload(trace, 'answer_composition')
  const answerSynthesis = answerCompositionPayload ? readRecord(answerCompositionPayload, 'answer_synthesis') : null
  const synthesisStatus = answerSynthesis ? readRecordField(answerSynthesis, 'status') : 'Unavailable'
  const routeSource = routePayload ? readRecordField(routePayload, 'route_source') : 'Unavailable'
  const llmIntent = routePayload ? readRecord(routePayload, 'llm_intent') : null
  const llmIntentStatus = llmIntent ? readRecordField(llmIntent, 'status') : 'Unavailable'
  const llmApplied = routeSource === 'local_llm_intent' || synthesisStatus === 'applied'
  const llmTopicTerms = readStringArray(routePayload ?? {}, 'topic_terms')
  const llmCitedEvidenceCount = readStringArray(answerSynthesis ?? {}, 'cited_evidence_ids').length
  const llmCitedMemoryCount = readStringArray(answerSynthesis ?? {}, 'cited_memory_ids').length

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow={translate("Evidence-backed historical reading", "Kaynak destekli geçmiş incelemesi")}
        title={t('The answer is only credible because the record is visible', 'Yanıt, kayıt görünür olduğu için güvenilirdir')}
        description={t('This is the inspectable reasoning view behind a chat answer, with evidence, memory objects, contradictions, drift, next actions, and uncertainty kept visible.', 'Bu, sohbet yanıtının arkasındaki incelenebilir akıl yürütme görünümüdür; kanıtlar, hafıza nesneleri, çelişkiler, değişimler, sonraki adımlar ve belirsizlik görünür kalır.')}
        actions={
          <Link className="secondary-button" to="/query">{t("Back to chat", "Sohbete dön")}</Link>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}
      {activeResult?.permissions_limited ? (
        <Callout tone="warning">{t('Some relevant evidence may be unavailable due to source permissions.', 'Bazı ilgili kanıtlar kaynak izinleri nedeniyle kullanılamayabilir.')}</Callout>
      ) : null}

      {isLoading ? <p className="muted-copy">{t('Loading query result…', 'Sorgu sonucu yükleniyor…')}</p> : null}

      {!isLoading && !activeResult ? (
        <EmptyState title={t('Result not available', 'Sonuç kullanılamıyor')} description={t('Submit a new query or verify that the requested query run still exists.', 'Yeni bir sorgu gönderin veya istenen sorgu çalışmasının hâlâ bulunduğunu doğrulayın.')} />
      ) : null}

      {activeResult ? (
        <>
          <Panel title={t('Result overview', 'Sonuç özeti')} description={activeResult.query_text} aside={<StatusBadge value={activeResult.status} />}>
            <div className="detail-grid">
              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Mode', 'Mod')}</p>
                <p className="table-primary">{activeResult.query_class}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Generated', 'Oluşturuldu')}</p>
                <p className="table-primary">{formatDateTime(activeResult.created_at)}</p>
              </article>
              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Historical support', 'Geçmiş desteği')}</p>
                <p className="table-primary">{activeResult.supporting_nodes.length + activeResult.supporting_evidence.length}{t(" linked items", " bağlantılı kayıt")}</p>
              </article>
            </div>
          </Panel>

          <Panel
            title={t('Local LLM output', 'Yerel LLM çıktısı')}
            description={t('Shows what the private model helped with and its exact answer wording, while deterministic evidence selection remains inspectable.', 'Özel modelin neye yardım ettiğini ve ürettiği yanıtı gösterir; belirleyici kanıt seçimi incelenebilir kalır.')}
            aside={<StatusBadge value={llmApplied ? translate("LLM applied", "LLM kullanıldı") : 'Deterministic'} />}
          >
            <article className={synthesisStatus === 'applied' ? 'panel-subtle llm-output-card action-card' : 'panel-subtle llm-output-card'}>
              <div className="timeline-card-head">
                <div>
                  <p className="section-label">{t('LLM-written answer', 'LLM tarafından yazılan yanıt')}</p>
                  <p className="table-secondary">{synthesisStatusLabel(synthesisStatus)}</p>
                </div>
                <StatusBadge value={synthesisStatus !== 'Unavailable' ? formatLabel(synthesisStatus) : translate("Trace loading", "İz yükleniyor")} />
              </div>
              <p className="llm-answer-text">{activeResult.answer_text}</p>
              <p className="llm-rationale-text">{activeResult.why_this_answer}</p>
            </article>

            <div className="detail-grid compact-boundary-grid">
              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Intent routing', 'Niyet yönlendirmesi')}</p>
                <p className="table-primary">{routeSource !== 'Unavailable' ? routeSourceLabel(routeSource) : translate("Trace loading", "İz yükleniyor")}</p>
                <p className="muted-copy">
                  {routeSource === 'local_llm_intent'
                    ? 'The LLM classified the question; deterministic execution kept authority over evidence and reasoning.'
                    : routeSource === 'keyword_after_llm_fallback'
                      ? translate("LLM routing was attempted, then deterministic keyword routing carried the query.", "LLM yönlendirmesi denendi; ardından anahtar sözcük yönlendirmesi soruyu işledi.")
                      : translate("Deterministic routing selected the query mode.", "Belirleyici yönlendirme soru türünü seçti.")}
                </p>
                {llmTopicTerms.length > 0 ? <p className="table-secondary">{t("Terms: ", "Terimler: ")}{llmTopicTerms.join(', ')}</p> : null}
              </article>

              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Citations accepted', 'Kabul edilen kaynaklar')}</p>
                <p className="table-primary">{llmCitedEvidenceCount}{t(" evidence · ", " kanıt · ")}{llmCitedMemoryCount}{t(" memory", " hafıza")}</p>
                <p className="muted-copy">{t('The LLM can only cite IDs already selected by the deterministic packet.', 'LLM yalnızca belirleyici paket tarafından seçilmiş kimlikleri kaynak gösterebilir.')}</p>
              </article>

              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Deterministic authority', 'Belirleyici yetki')}</p>
                <p className="table-primary">{activeResult.supporting_evidence.length}{t(" excerpts · ", " alıntı · ")}{activeResult.supporting_nodes.length}{t(" objects", " nesne")}</p>
                <p className="muted-copy">{t('Permissions, evidence selection, contradiction and drift checks, and next-action promotion remain system-controlled.', 'İzinler, kanıt seçimi, çelişki ve değişim kontrolleri ile sonraki eylemin öne çıkarılması sistemin kontrolünde kalır.')}</p>
              </article>
            </div>
          </Panel>

          <details className="reasoning-disclosure panel section-panel">
            <summary>{t('Inference and authority boundary details', 'Çıkarım ve yetki sınırı ayrıntıları')}</summary>
            <div className="detail-grid">
              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Query routing', 'Sorgu yönlendirmesi')}</p>
                <p className="table-primary">{routeSource !== 'Unavailable' ? routeSourceLabel(routeSource) : translate("Trace loading", "İz yükleniyor")}</p>
                {llmIntentStatus !== 'Unavailable' ? <p className="table-secondary">{t("LLM intent status: ", "LLM niyet durumu: ")}{formatLabel(llmIntentStatus)}</p> : null}
              </article>

              <article className={synthesisStatus === 'applied' ? 'panel-subtle detail-card action-card' : 'panel-subtle detail-card'}>
                <p className="section-label">{t('Answer wording', 'Yanıt yazımı')}</p>
                <p className="table-primary">{synthesisStatus !== 'Unavailable' ? synthesisStatusLabel(synthesisStatus) : translate("Trace loading", "İz yükleniyor")}</p>
                {readRecordField(answerSynthesis ?? {}, 'confidence_rationale') !== 'Unavailable' ? (
                  <p className="muted-copy">{readRecordField(answerSynthesis ?? {}, 'confidence_rationale')}</p>
                ) : null}
              </article>

              <article className="panel-subtle detail-card">
                <p className="section-label">{t('Evidence authority', 'Kanıt yetkisi')}</p>
                <p className="table-primary">
                  {activeResult.supporting_evidence.length}{t(" evidence excerpts · ", " kaynak alıntısı · ")}{activeResult.supporting_nodes.length}{t("memory objects", "hafıza nesnesi")}</p>
                <p className="muted-copy">{t('Permission filtering, evidence selection, contradiction and drift analysis, and next-action generation remain deterministic.', 'İzin filtreleme, kanıt seçimi, çelişki ve değişim analizi ile sonraki eylem üretimi belirleyici kalır.')}</p>
              </article>
            </div>
          </details>

          <Panel
            title={t('Decision intelligence packet', 'Karar zekâsı paketi')}
            description={t("Read this as the product's core output: answer, tension, drift, evidence strength, and next move in one inspectable packet.", 'Bunu ürünün temel çıktısı olarak okuyun: yanıt, gerilim, değişim, kanıt gücü ve sonraki adım tek bir incelenebilir pakette.')}
          >
            <div className="stack-lg">
              <article className="panel-subtle stack-sm action-card">
                <div className="timeline-card-head">
                  <p className="section-label">{t('Direct reading', 'Doğrudan okuma')}</p>
                  <p className="table-secondary">{modePlainEnglish(activeResult.query_class)}</p>
                </div>
                <p className="evidence-block">{activeResult.answer_text}</p>
                <p className="muted-copy">{activeResult.why_this_answer}</p>
              </article>

              <div className="detail-grid">
                <article className={topContradiction ? 'panel-subtle detail-card critical-card' : 'panel-subtle detail-card'}>
                  <p className="section-label">{t('Contradiction state', 'Çelişki durumu')}</p>
                  <p className="table-primary">
                    {topContradiction
                      ? `${readRecordField(topContradiction, 'from_title')} ↔ ${readRecordField(topContradiction, 'to_title')}`
                      : translate("No visible contradiction returned", "Görünen çelişki yok")}
                  </p>
                  <p className="muted-copy">
                    {topContradiction
                      ? firstAvailable(readRecordField(topContradiction, 'evidence_provenance'), readRecordField(topContradiction, 'evidence_span'))
                      : translate("The answer did not need a conflict edge in the current permitted scope.", "Yanıt için mevcut izin kapsamında çelişki bağlantısı gerekmedi.")}
                  </p>
                </article>
                <article className={topDrift ? 'panel-subtle detail-card drift-card' : 'panel-subtle detail-card'}>
                  <p className="section-label">{t('Assumption drift', 'Varsayım değişimi')}</p>
                  <p className="table-primary">
                    {topDrift ? `${readRecordField(topDrift, 'title_or_label')} · ${formatLabel(readRecordField(topDrift, 'status'))}` : translate("No visible drift returned", "Görünen değişim yok")}
                  </p>
                  <p className="muted-copy">
                    {topDrift
                      ? firstAvailable(readRecordField(topDrift, 'evidence_provenance'), readRecordField(topDrift, 'validity_notes'))
                      : translate("No stale, weakening, or reversed assumption was attached to this answer.", "Bu yanıta geçersiz, zayıflayan veya tersine dönen varsayım eklenmedi.")}
                  </p>
                </article>
                <article className="panel-subtle detail-card">
                  <p className="section-label">{t('Evidence strength', 'Kanıt gücü')}</p>
                  <p className="table-primary">
                    {activeResult.supporting_evidence.length}{t(" evidence excerpts · ", " kaynak alıntısı · ")}{graphEvidenceCount}{t("graph-linked", "grafik bağlantılı")}</p>
                  <p className="muted-copy">
                    {activeResult.supporting_nodes.length}{t(" structured memory objects and ", " yapılandırılmış hafıza nesnesi ve ")}{activeResult.related_signals.length}{t("persisted signal links support this review-aware packet.", "kayıtlı sinyal bağlantısı bu inceleme paketini destekler.")}</p>
                </article>
                <article className={topAction ? 'panel-subtle detail-card action-card' : 'panel-subtle detail-card'}>
                  <p className="section-label">{t('Next justified move', 'Gerekçeli sonraki adım')}</p>
                  <p className="table-primary">{topAction ?? translate("No next action promoted", "Sonraki iş önerilmedi")}</p>
                  <p className="muted-copy">
                    {topAction
                      ? translate("Recommendation is downstream of the visible memory objects, conflict/drift checks, and evidence excerpts.", "Öneri, görünen hafıza nesneleri, çelişki/değişim kontrolleri ve kaynak alıntılarına dayanır.")
                      : translate("Izge did not promote a recommendation without enough visible support.", "İzge yeterli görünür kaynak olmadan öneri sunmadı.")}
                  </p>
                </article>
              </div>
            </div>
          </Panel>

          <div className="result-grid">
            <Panel title={t('Evidence chain', 'Kanıt zinciri')} description={t('Permitted evidence excerpts surfaced in the response. This is the proof surface, not citation decoration.', 'Yanıtta gösterilen izinli kanıt alıntıları. Bu, kaynak süsü değil kanıt yüzeyidir.')}>
              {activeResult.supporting_evidence.length === 0 ? (
                <EmptyState title={t('No evidence references', 'Kanıt kaynağı yok')} description={t('The system did not return visible evidence excerpts for this query.', 'Sistem bu sorgu için görünür kanıt alıntısı döndürmedi.')} />
              ) : (
                <div className="stack-md">
                  {activeResult.supporting_evidence.map((item) => (
                    <article key={`${item.artifact_id}-${item.chunk_id ?? 'root'}`} className="panel-subtle stack-sm">
                      <div className="timeline-card-head">
                        <p className="table-primary">{item.artifact_title}</p>
                        <StatusBadge value={item.artifact_review_status} />
                      </div>
                      <p className="table-secondary">{item.evidence_kind === 'graph' ? translate("Graph-linked evidence", "Grafik bağlantılı kanıt") : translate("Search fallback evidence", "Arama yedek kanıtı")}{t(" · chunk ", " · parça ")}{item.chunk_id ?? 'root'}</p>
                      <p className="evidence-block">{item.excerpt}</p>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={t('Related Memory Objects', 'İlgili hafıza nesneleri')} description={t('Structured memory references included with the response.', 'Yanıta eklenen yapılandırılmış hafıza kaynakları.')}>
              {activeResult.supporting_nodes.length === 0 ? (
                <EmptyState title={t('No supporting memory objects', 'Destekleyici hafıza nesnesi yok')} description={t('No linked memory objects are currently visible in scope.', 'Kapsamda şu anda görünür bağlantılı hafıza nesnesi yok.')} />
              ) : (
                <div className="stack-sm">
                  {activeResult.supporting_nodes.map((item) => (
                    <Link
                      key={`${item.memory_type}-${item.memory_id}`}
                      className="record-link panel-subtle"
                      to={`/memory/${item.memory_type}/${item.memory_id}`}
                    >
                      <div>
                        <p className="table-primary">{item.title_or_label}</p>
                        <p className="table-secondary">
                          {formatLabel(item.memory_type)}{t(" · topic ", " · konu ")}{item.topic_key}{t(" · source ", " · kaynak ")}{formatLabel(item.source_artifact_review_status)}
                        </p>
                        {item.memory_type === 'commitment' ? (
                          <p className="table-secondary">
                            {item.status ? `Status ${formatLabel(item.status)} · ` : ''}
                            {item.owner_label ? `Owner ${item.owner_label} · ` : ''}
                            {item.due_date ? `Due ${formatDate(item.due_date)}` : translate("No due date captured", "Son tarih kaydedilmedi")}
                          </p>
                        ) : null}
                      </div>
                      <span className="table-secondary">{t('Confidence', 'Güven')} {formatPercent(item.confidence_score)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={t('Contradictions / Tensions', 'Çelişkiler / Gerilimler')} description={t('Conflict signals are preserved so a later claim visibly collides with the earlier record.', 'Sonraki bir ifadenin önceki kayıtla çelişkisi görünür olsun diye çelişki sinyalleri korunur.')}>
              {activeResult.contradictions.length === 0 ? (
                <EmptyState title={t('No contradictions returned', 'Çelişki bulunamadı')} description={t('This result did not surface contradiction edges in the current permitted scope.', 'Bu sonuç mevcut izinli kapsamda çelişki bağlantısı göstermedi.')} />
              ) : (
                <div className="stack-sm">
                  {activeResult.contradictions.map((item) => (
                    <article key={readRecordField(item, 'edge_id')} className="panel-subtle stack-sm critical-card">
                      <p className="table-primary">{readRecordField(item, 'from_title')} → {readRecordField(item, 'to_title')}</p>
                      <p className="table-secondary">{readRecordField(item, 'from_type')} {readRecordField(item, 'relation_label')} {readRecordField(item, 'to_type')}{t(" · topic ", " · konu ")}{readRecordField(item, 'topic_key')}</p>
                      <div className="stack-sm">
                        <div className="panel-subtle stack-sm">
                          <p className="section-label">{t('Later claim evidence', 'Sonraki ifade kanıtı')}</p>
                          <p className="table-secondary">{readRecordField(item.from_evidence as Record<string, unknown>, 'artifact_title')}</p>
                          <p className="muted-copy">{readRecordField(item.from_evidence as Record<string, unknown>, 'excerpt')}</p>
                          <p className="table-secondary">{readRecordField(item.from_evidence as Record<string, unknown>, 'provenance')}</p>
                        </div>
                        <div className="panel-subtle stack-sm">
                          <p className="section-label">{t('Earlier claim evidence', 'Önceki ifade kanıtı')}</p>
                          <p className="table-secondary">{readRecordField(item.to_evidence as Record<string, unknown>, 'artifact_title')}</p>
                          <p className="muted-copy">{readRecordField(item.to_evidence as Record<string, unknown>, 'excerpt')}</p>
                          <p className="table-secondary">{readRecordField(item.to_evidence as Record<string, unknown>, 'provenance')}</p>
                        </div>
                      </div>
                      {readStringArray(item, 'ranking_basis').length > 0 ? <p className="table-secondary">{t("Ranked for: ", "Öncelik gerekçesi: ")}{readStringArray(item, 'ranking_basis').join(', ')}</p> : null}
                      {readRecordField(item, 'uncertainty_note') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(item, 'uncertainty_note')}</p> : null}
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={t('Assumption Drift', 'Varsayım değişimi')} description={t('Assumptions flagged as stale, weakened, or reversed.', 'Eski, zayıflamış veya tersine dönmüş olarak işaretlenen varsayımlar.')}>
              {activeResult.stale_assumptions.length === 0 ? (
                <EmptyState title={t('No drift returned', 'Değişim bulunamadı')} description={t('No visible stale assumptions were attached to this response.', 'Bu yanıta görünür eski varsayım eklenmedi.')} />
              ) : (
                <div className="stack-sm">
                  {activeResult.stale_assumptions.map((item) => (
                    <article key={readRecordField(item, 'assumption_id')} className="panel-subtle stack-sm drift-card">
                      <p className="table-primary">{readRecordField(item, 'title_or_label')}</p>
                      <p className="table-secondary">{t("Status: ", "Durum: ")}{formatLabel(readRecordField(item, 'status'))}{t(" · topic ", " · konu ")}{readRecordField(item, 'topic_key')}</p>
                      <p className="muted-copy">{readRecordField(item, 'validity_notes')}</p>
                      {readRecordField(item, 'supporting_signal_title') !== 'Unavailable' ? <p className="table-secondary">{t("Compared with: ", "Karşılaştırılan: ")}{readRecordField(item, 'supporting_signal_type')} · {readRecordField(item, 'supporting_signal_title')}</p> : null}
                      {readRecordField(item, 'evidence_span') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(item, 'evidence_span')}</p> : null}
                      {readRecordField(item, 'evidence_provenance') !== 'Unavailable' ? <p className="table-secondary">{readRecordField(item, 'evidence_provenance')}</p> : null}
                      {readStringArray(item, 'ranking_basis').length > 0 ? <p className="table-secondary">{t("Ranked for: ", "Öncelik gerekçesi: ")}{readStringArray(item, 'ranking_basis').join(', ')}</p> : null}
                      {readRecordField(item, 'uncertainty_note') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(item, 'uncertainty_note')}</p> : null}
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={t('Recommended Next Actions', 'Önerilen sonraki adımlar')} description={t('Action guidance remains explicit, grounded, and downstream of visible evidence.', 'Eylem yönlendirmesi açık, kaynaklı ve görünür kanıtlara bağlı kalır.')}>
              {activeResult.recommended_next_actions.length === 0 ? (
                <EmptyState title={t('No next actions returned', 'Sonraki adım bulunamadı')} description={t('This result did not require a recommendation from the current analysis path.', 'Bu sonuç mevcut analiz yolundan bir öneri gerektirmedi.')} />
              ) : (
                <ul className="bullet-list action-list">
                  {activeResult.recommended_next_actions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t('Related persisted signals', 'İlgili kayıtlı sinyaller')} description={t('Query answers link to durable contradiction, drift, supersession, or next-action records created during processing.', 'Sorgu yanıtları işleme sırasında oluşturulan kalıcı çelişki, değişim, yerine geçme veya sonraki eylem kayıtlarına bağlanır.')}>
              {activeResult.related_signals.length === 0 ? (
                <EmptyState title={t('No persisted signal links', 'Kayıtlı sinyal bağlantısı yok')} description={t('This query result did not overlap with persisted proactive signals in the current permission scope.', 'Bu sorgu sonucu mevcut izin alanındaki kayıtlı proaktif sinyallerle örtüşmedi.')} />
              ) : (
                <div className="stack-sm">
                  {activeResult.related_signals.map((signal) => (
                    <Link key={signal.signal_id} className="record-link panel-subtle" to={`/signals/${signal.signal_id}`}>
                      <div>
                        <p className="table-primary">{signal.title}</p>
                        <p className="table-secondary">
                          {formatLabel(signal.signal_type)} · {signal.source_artifact_title ?? signal.source_artifact_id ?? translate("unknown source", "bilinmeyen kaynak")}
                        </p>
                      </div>
                      <span className="table-secondary">{t("Urgency ", "Aciliyet ")}{formatPercent(signal.urgency_score)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={t('Uncertainty or Missing Context', 'Belirsizlik veya eksik bağlam')} description={t('Required caveats and limits surfaced alongside the answer.', 'Gerekli uyarılar ve sınırlar yanıtla birlikte gösterilir.')}>
              <ul className="bullet-list">
                {activeResult.uncertainty_notes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                {activeResult.permissions_limited ? <li>{t('Some relevant evidence may be hidden by source permissions.', 'Bazı ilgili kanıtlar kaynak izinleri nedeniyle gizli olabilir.')}</li> : null}
              </ul>
            </Panel>

            <details className="reasoning-disclosure panel section-panel">
              <summary>{t('Inspectable reasoning path', 'İncelenebilir akıl yürütme yolu')}</summary>
              <p className="section-description">{t('Trace details remain available for trust and audit, but stay collapsed so the main answer remains readable.', 'İz ayrıntıları güven ve denetim için kullanılabilir kalır ancak ana yanıtın okunabilirliği için kapalı tutulur.')}</p>
              {!trace ? (
                <EmptyState title={t('Trace not loaded', 'İz yüklenmedi')} description={t('The query result is visible, but the inspectable reasoning path could not be loaded.', 'Sorgu sonucu görünür ancak incelenebilir akıl yürütme yolu yüklenemedi.')} />
              ) : (
                <div className="stack-md">
                  <article className="panel-subtle stack-sm">
                    <p className="section-label">{t('Route confidence', 'Yönlendirme güveni')}</p>
                    <p className="table-primary">{formatPercent(trace.route_confidence)}</p>
                    <p className="table-secondary">{trace.query_class}</p>
                    {trace.permissions_limited ? <p className="muted-copy">{t('Some trace items may be reduced because source permissions hide part of the reasoning path.', 'Kaynak izinleri akıl yürütme yolunun bir bölümünü gizlediği için bazı iz öğeleri azaltılmış olabilir.')}</p> : null}
                  </article>

                  {trace.steps.map((step: QueryTraceStepRead) => {
                    const payload = step.payload as Record<string, unknown>
                    const supportingNodes = readRecordArray(payload, 'supporting_nodes')
                    const contradictionPairs = readRecordArray(payload, 'contradiction_pairs')
                    const staleAssumptions = readRecordArray(payload, 'stale_assumptions')
                    const supportingEvidence = readRecordArray(payload, 'supporting_evidence')
                    const orchestrationStages = readRecordArray(payload, 'stages')
                    const retrievalRecipe = readRecordArray(payload, 'retrieval_recipe')
                    const selectedMemory = readRecordArray(payload, 'selected_memory')
                    const selectedEvidencePacket = readRecordArray(payload, 'selected_evidence')
                    const evidenceBudget = readRecord(payload, 'evidence_budget')
                    const metrics = readRecord(payload, 'metrics')
                    const verifierChecks = readRecord(payload, 'checks')
                    const sectionCounts = payload.section_counts as Record<string, unknown> | undefined
                    const stepAnswerSynthesis = readRecord(payload, 'answer_synthesis')
                    const stepSynthesisStatus = stepAnswerSynthesis ? readRecordField(stepAnswerSynthesis, 'status') : 'Unavailable'
                    return (
                      <article key={`${step.step_kind}-${step.created_at}`} className="panel-subtle stack-sm">
                        <div className="timeline-card-head">
                          <p className="table-primary">{stepTitle(step.step_kind)}</p>
                          <p className="table-secondary">{formatDateTime(step.created_at)}</p>
                        </div>

                        {readRecordField(payload, 'route_rationale') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(payload, 'route_rationale')}</p> : null}
                        {readRecordField(payload, 'route_source') !== 'Unavailable' ? <p className="table-secondary">{t("Route source: ", "Yönlendirme kaynağı: ")}{routeSourceLabel(readRecordField(payload, 'route_source'))}</p> : null}
                        {readStringArray(payload, 'topic_terms').length > 0 ? <p className="table-secondary">{t("Topic terms: ", "Konu terimleri: ")}{readStringArray(payload, 'topic_terms').join(', ')}</p> : null}
                        {readStringArray(payload, 'secondary_signals').length > 0 ? <p className="table-secondary">{t("Secondary signals: ", "İkincil sinyaller: ")}{readStringArray(payload, 'secondary_signals').join(', ')}</p> : null}
                        {readRecordField(payload, 'schema_version') !== 'Unavailable' ? <p className="table-secondary">{t("Trace schema: ", "İz şeması: ")}{readRecordField(payload, 'schema_version')}</p> : null}
                        {readRecordField(payload, 'context_packet_id') !== 'Unavailable' ? <p className="table-secondary">{t("Context packet: ", "Bağlam paketi: ")}{readRecordField(payload, 'context_packet_id')}</p> : null}
                        {readRecordField(payload, 'verifier_status') !== 'Unavailable' ? <p className="table-secondary">{t("Verifier status: ", "Doğrulayıcı durumu: ")}{formatLabel(readRecordField(payload, 'verifier_status'))}</p> : null}

                        {orchestrationStages.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">{t('Bounded stage plan', 'Sınırlı aşama planı')}</p>
                            {orchestrationStages.map((item) => (
                              <article key={readRecordField(item, 'stage_key')} className="panel-subtle stack-sm">
                                <div className="timeline-card-head">
                                  <p className="table-secondary">{formatLabel(readRecordField(item, 'stage_key'))}</p>
                                  <StatusBadge value={formatLabel(readRecordField(item, 'status'))} />
                                </div>
                                <p className="muted-copy">{readRecordField(item, 'reason')}</p>
                                <p className="table-secondary">{t("Authority: ", "Yetki: ")}{formatLabel(readRecordField(item, 'authority_level'))}{t(" · Outputs: ", " · Çıktılar: ")}{String(item.output_count ?? 0)}</p>
                              </article>
                            ))}
                          </div>
                        ) : null}

                        {retrievalRecipe.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">{t('Retrieval recipe', 'Erişim yöntemi')}</p>
                            {retrievalRecipe.map((item) => (
                              <p key={readRecordField(item, 'stage')} className="table-secondary">
                                {formatLabel(readRecordField(item, 'stage'))}: {String(item.selected_count ?? 0)} / {String(item.candidate_count ?? 0)}{t(" selected · omitted ", " seçilen · dışlanan ")}{String(item.omitted_count ?? 0)}
                              </p>
                            ))}
                            {evidenceBudget ? (
                              <p className="table-secondary">{t("Evidence budget:", "Kanıt bütçesi:")}{String(evidenceBudget.selected_evidence_count ?? 0)} / {String(evidenceBudget.max_selected_evidence ?? 0)}{t(" selected · ", " seçilen · ")}{evidenceBudget.within_budget === true ? translate("within budget", "bütçe içinde") : translate("outside budget", "bütçe dışında")}
                              </p>
                            ) : null}
                            {metrics ? (
                              <p className="table-secondary">{t("Trace payload:", "İz verisi:")}{String(metrics.trace_payload_bytes ?? 0)}{t(" bytes · assembly ", " bayt · birleştirme ")}{String(metrics.context_assembly_ms ?? 0)} ms
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {selectedMemory.length > 0 || selectedEvidencePacket.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">{t('Typed packet contents', 'Türlenmiş paket içeriği')}</p>
                            {selectedMemory.length > 0 ? <p className="table-secondary">{t("Memory objects: ", "Hafıza nesneleri: ")}{selectedMemory.map((item) => readRecordField(item, 'title_or_label')).join(', ')}</p> : null}
                            {selectedEvidencePacket.length > 0 ? (
                              <p className="table-secondary">{t("Evidence IDs:", "Kanıt kimlikleri:")}{selectedEvidencePacket.map((item) => firstAvailable(readRecordField(item, 'chunk_id'), readRecordField(item, 'artifact_id'))).join(', ')}
                              </p>
                            ) : null}
                          </div>
                        ) : null}

                        {verifierChecks ? (
                          <div className="stack-sm">
                            <p className="section-label">{t('Verifier checks', 'Doğrulayıcı kontrolleri')}</p>
                            <p className="table-secondary">{t("Status: ", "Durum: ")}{formatLabel(readRecordField(payload, 'status'))}</p>
                            <p className="table-secondary">
                              {Object.entries(verifierChecks)
                                .map(([key, value]) => `${formatLabel(key)}: ${value === true ? 'pass' : 'check'}`)
                                .join(' · ')}
                            </p>
                            {readRecordField(payload, 'authority_boundary') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(payload, 'authority_boundary')}</p> : null}
                          </div>
                        ) : null}

                        {supportingNodes.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">{t('Selected memory seeds', 'Seçilen hafıza başlangıçları')}</p>
                            {supportingNodes.map((item) => (
                              <p key={`${readRecordField(item, 'memory_type')}-${readRecordField(item, 'memory_id')}`} className="table-secondary">
                                {readRecordField(item, 'memory_type')} · {readRecordField(item, 'title_or_label')}
                              </p>
                            ))}
                          </div>
                        ) : null}

                        {contradictionPairs.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">{t('Compared contradiction pairs', 'Karşılaştırılan çelişki çiftleri')}</p>
                            {contradictionPairs.map((item) => (
                              <p key={`${readRecordField(item, 'from_title')}-${readRecordField(item, 'to_title')}`} className="table-secondary">
                                {readRecordField(item, 'from_title')} → {readRecordField(item, 'to_title')}
                              </p>
                            ))}
                          </div>
                        ) : null}

                        {staleAssumptions.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">{t('Drift candidates', 'Değişim adayları')}</p>
                            {staleAssumptions.map((item) => (
                              <p key={readRecordField(item, 'title_or_label')} className="table-secondary">
                                {readRecordField(item, 'title_or_label')} · {formatLabel(readRecordField(item, 'status'))}
                              </p>
                            ))}
                          </div>
                        ) : null}

                        {supportingEvidence.length > 0 ? (
                          <div className="stack-sm">
                            <p className="section-label">{t('Selected evidence', 'Seçilen kanıt')}</p>
                            {supportingEvidence.map((item) => (
                              <article key={`${readRecordField(item, 'artifact_id')}-${readRecordField(item, 'chunk_id')}`} className="panel-subtle stack-sm">
                                <p className="table-secondary">{readRecordField(item, 'artifact_title')} · {readRecordField(item, 'evidence_kind')}</p>
                                {readRecordField(item, 'excerpt') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(item, 'excerpt')}</p> : null}
                                {readRecordField(item, 'why_selected') !== 'Unavailable' ? <p className="table-secondary">{readRecordField(item, 'why_selected')}</p> : null}
                              </article>
                            ))}
                          </div>
                        ) : null}

                        {sectionCounts ? (
                          <div className="stack-sm">
                            <p className="section-label">{t('Answer composition', 'Yanıt bileşimi')}</p>
                            <p className="table-secondary">{t("Nodes", "Düğümler")}{String(sectionCounts.supporting_nodes ?? 0)}{t(" · Evidence ", " · Kanıt ")}{String(sectionCounts.supporting_evidence ?? 0)}{t(" · Contradictions ", " · Çelişkiler ")}{String(sectionCounts.contradictions ?? 0)}{t(" · Drift ", " · Değişim ")}{String(sectionCounts.assumption_drift ?? 0)}{t(" · Actions ", " · İşler ")}{String(sectionCounts.recommended_next_actions ?? 0)}
                            </p>
                          </div>
                        ) : null}

                        {stepAnswerSynthesis ? (
                          <div className="stack-sm">
                            <p className="section-label">{t('Answer synthesis boundary', 'Yanıt sentezi sınırı')}</p>
                            <p className="table-secondary">{synthesisStatusLabel(stepSynthesisStatus)}</p>
                            {readRecordField(stepAnswerSynthesis, 'confidence_rationale') !== 'Unavailable' ? (
                              <p className="muted-copy">{readRecordField(stepAnswerSynthesis, 'confidence_rationale')}</p>
                            ) : null}
                            {readRecordField(stepAnswerSynthesis, 'fallback_reason') !== 'Unavailable' ? (
                              <p className="muted-copy">{readRecordField(stepAnswerSynthesis, 'fallback_reason')}</p>
                            ) : null}
                            {readStringArray(stepAnswerSynthesis, 'cited_memory_ids').length > 0 ? (
                              <p className="table-secondary">{t("Validated memory citations: ", "Doğrulanan hafıza referansları: ")}{readStringArray(stepAnswerSynthesis, 'cited_memory_ids').join(', ')}</p>
                            ) : null}
                          </div>
                        ) : null}

                        {readRecordField(payload, 'direct_answer') !== 'Unavailable' ? <p className="muted-copy">{readRecordField(payload, 'direct_answer')}</p> : null}
                        {readStringArray(payload, 'notes').length > 0 ? (
                          <ul className="bullet-list">
                            {readStringArray(payload, 'notes').map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        ) : null}
                        {typeof payload.omitted_items === 'number' && payload.omitted_items > 0 ? <p className="table-secondary">{t("Hidden by current permissions: ", "Mevcut izinlere göre gizlenen: ")}{String(payload.omitted_items)}{t(" trace item(s)", " iz kaydı")}</p> : null}
                      </article>
                    )
                  })}
                </div>
              )}
            </details>
          </div>
        </>
      ) : null}
    </div>
  )
}

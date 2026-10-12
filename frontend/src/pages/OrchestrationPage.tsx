import { formatDateTime, formatSystemText } from '../lib/format'
import { translate } from '../lib/language'
import { useEffect, useState, type FormEventHandler } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatLabel, formatPercent } from '../lib/format'
import { useLanguage } from '../lib/i18n'
import type {
  OrchestrationBlueprintRead,
  OrchestrationJobListRead,
  OrchestrationStageRunsRead,
  ScenarioImpactRead,
  ScenarioReplayRead,
  ScenarioRunListRead,
  ScenarioTemplateCatalogItem,
} from '../lib/types'

export function OrchestrationPage() {
  const { t } = useLanguage()
  const { session } = useAuth()
  const [blueprint, setBlueprint] = useState<OrchestrationBlueprintRead | null>(null)
  const [stageRuns, setStageRuns] = useState<OrchestrationStageRunsRead | null>(null)
  const [jobQueue, setJobQueue] = useState<OrchestrationJobListRead | null>(null)
  const [scenarioRuns, setScenarioRuns] = useState<ScenarioRunListRead | null>(null)
  const [scenarioReplay, setScenarioReplay] = useState<ScenarioReplayRead | null>(null)
  const [scenarioTemplates, setScenarioTemplates] = useState<ScenarioTemplateCatalogItem[]>([])
  const [scenarioText, setScenarioText] = useState('')
  const [scenarioResult, setScenarioResult] = useState<ScenarioImpactRead | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isScenarioRunning, setIsScenarioRunning] = useState(false)
  const [replayingRunId, setReplayingRunId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token) {
        return
      }
      try {
        const [payload, runsPayload, jobsPayload, templatesPayload, scenarioRunsPayload] = await Promise.all([
          api.getOrchestrationBlueprint(session.token),
          api.listOrchestrationStageRuns(session.token, 40),
          api.listOrchestrationJobs(session.token, 20),
          api.listScenarioTemplates(session.token),
          api.listScenarioRuns(session.token, 12),
        ])
        if (!cancelled) {
          setBlueprint(payload)
          setStageRuns(runsPayload)
          setJobQueue(jobsPayload)
          setScenarioTemplates(templatesPayload)
          setScenarioRuns(scenarioRunsPayload)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load orchestration blueprint.', 'Orkestrasyon planı yüklenemedi.'))
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [session?.token, t])

  const handleScenario: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token) {
      return
    }
    setIsScenarioRunning(true)
    setError(null)
    setScenarioResult(null)
    setScenarioReplay(null)
    try {
      const result = await api.runScenarioImpact(session.token, scenarioText, 10)
      setScenarioResult(result)
      const runsPayload = await api.listScenarioRuns(session.token, 12)
      setScenarioRuns(runsPayload)
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to run bounded scenario support.', 'Sınırlı senaryo desteği çalıştırılamadı.'))
    } finally {
      setIsScenarioRunning(false)
    }
  }

  const updateScenarioText = (value: string) => {
    setScenarioText(value)
    setScenarioResult(null)
    setScenarioReplay(null)
    setError(null)
  }

  const handleReplayScenario = async (scenarioRunId: string) => {
    if (!session?.token) {
      return
    }
    setReplayingRunId(scenarioRunId)
    setError(null)
    try {
      const replay = await api.replayScenarioRun(session.token, scenarioRunId)
      setScenarioReplay(replay)
      const runsPayload = await api.listScenarioRuns(session.token, 12)
      setScenarioRuns(runsPayload)
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to replay scenario run.', 'Senaryo çalışması yeniden oynatılamadı.'))
    } finally {
      setReplayingRunId(null)
    }
  }


  const templatePrompts = scenarioTemplates
    .map((template) => ({
      key: template.template_key,
      title: formatSystemText(template.title),
      prompt: formatSystemText(template.example_prompts[0] ?? template.review_lens[0]),
    }))
    .filter((template) => template.prompt)

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow={t('Jobs and orchestration', 'İşler ve orkestrasyon')}
        title={t('Runs and scenarios', 'Çalışmalar ve senaryolar')}
        description={t('Monitor current work, review results, or test a company scenario.', 'Güncel işleri izleyin, sonuçları inceleyin veya bir şirket senaryosunu test edin.')}
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <dl className="review-ledger" aria-label={t('Run summary', 'Çalışma özeti')}>
        <div><dt>{t('Recent jobs', 'Son işler')}</dt><dd>{jobQueue ? jobQueue.jobs.length : '—'}</dd></div>
        <div><dt>{t('Stage records', 'İşlem kayıtları')}</dt><dd>{stageRuns ? stageRuns.runs.length : '—'}</dd></div>
        <div><dt>{t('Scenario analyses', 'Senaryo analizleri')}</dt><dd>{scenarioRuns ? scenarioRuns.runs.length : '—'}</dd></div>
      </dl>

      <Panel title={t('Recent work', 'Son işler')} description={t('Follow the status of background work and inspect any failures.', 'Arka planda yürütülen işlerin durumunu takip edin, hata varsa ayrıntısını inceleyin.')}>
        {jobQueue && jobQueue.jobs.length > 0 ? (
          <div className="stack-sm">
            {jobQueue.jobs.map((job) => (
              <article key={job.job_id} className="run-list-row stack-sm">
                <div className="timeline-card-head">
                  <div>
                    <p className="section-label">{formatLabel(job.job_kind)} · {t('priority', 'öncelik')} {job.priority}</p>
                    <p className="table-primary">{job.stage_key ? formatLabel(job.stage_key) : formatLabel(job.job_kind)}</p>
                  </div>
                  <StatusBadge value={job.status} />
                </div>
                <p className="table-secondary">{formatDateTime(job.created_at)}{job.completed_at ? ` · ${t('Completed', 'Tamamlandı')} ${formatDateTime(job.completed_at)}` : ''}</p>
                {job.error_message ? <Callout tone="warning">{formatSystemText(job.error_message)}</Callout> : null}
                <details className="technical-details">
                  <summary>{t('Technical job details', 'Teknik iş ayrıntıları')}</summary>
                  <p className="table-secondary">{t('Job ID', 'İş kimliği')}: {job.job_id}</p>
                <p className="table-secondary">{t('Lease', 'Kiralama')}: {job.lease_owner ?? t('not claimed', 'atanmadı')} · {t('Query', 'Sorgu')}: {job.query_run_id ?? t('standalone job', 'bağımsız iş')}</p>
                <p className="muted-copy">{t('Created', 'Oluşturuldu')} {formatDateTime(job.created_at)} · {t('available', 'uygun')} {formatDateTime(job.available_at)}</p>
                <p className="evidence-block">{t("Payload boundary: ", "Veri sınırı: ")}{String(job.payload_json.schema_version ?? translate("bounded payload", "sınırlı veri"))}{t(" · trusted writes ", " · güvenilir yazma işlemi ")}{job.payload_json.trusted_write_allowed === false ? t('Blocked', 'Engellendi') : translate("not requested", "istenmedi")}</p>
                {job.completed_at ? <p className="table-secondary">{t("Completed ", "Tamamlandı ")}{formatDateTime(job.completed_at)}</p> : null}
                </details>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title={t('No background work yet', 'Henüz arka plan işi yok')} description={t('Work created by company workflows will appear here. You can also analyse a scenario below.', 'Şirket iş akışlarının oluşturduğu işler burada görünür. Aşağıdan bir senaryonun etkisini de inceleyebilirsiniz.')} />
        )}
      </Panel>

      <Panel title={t('What would this change affect?', 'Bu değişiklik neleri etkiler?')} description={t('Describe a change to find relevant decisions, commitments and sources. Results are based on existing evidence, not predictions.', 'Bir değişiklik yazın; ilgili kararları, taahhütleri ve kaynakları bulun. Sonuçlar mevcut kanıtlara dayanır, gelecek tahmini değildir.')}>
        <details className="employee-focus-details">
          <summary>{t('Use an example', 'Bir örnek kullan')}</summary>
          <div className="signal-grid">
            {templatePrompts.map((template) => (
              <button key={template.key} type="button" className="prompt-card" onClick={() => updateScenarioText(template.prompt)}>
                <span className="section-label">{template.title}</span>
                {template.prompt}
              </button>
            ))}
          </div>
        </details>
        <form className="form-grid" onSubmit={handleScenario}>
          <label className="field">
            <span className="field-label">{t('Scenario', 'Senaryo')}</span>
            <textarea name="scenario" value={scenarioText} onChange={(event) => updateScenarioText(event.target.value)} rows={3} placeholder={t('For example: which commitments are affected if delivery slips by a week?', 'Örneğin: teslimat bir hafta gecikirse hangi taahhütler etkilenir?')} autoComplete="off" required />
          </label>
          <button type="submit" className="primary-button" disabled={isScenarioRunning}>{isScenarioRunning ? t('Checking scenario…', 'Senaryo kontrol ediliyor…') : t('Analyse impact', 'Etkisini incele')}</button>
        </form>

        {scenarioResult ? (
          <div className="stack-md">
            <p className="evidence-block">{scenarioResult.answer_text}</p>
            <div className="panel-subtle stack-sm">
              <div className="timeline-card-head">
                <div>
                  <p className="section-label">{t('Scenario lens', 'Senaryo bakışı')}</p>
                  <p className="table-primary">{scenarioResult.scenario_template.title}</p>
                </div>
                <StatusBadge value={formatPercent(scenarioResult.scenario_template.confidence_score)} />
              </div>
              <p className="table-secondary">{t("Matched terms: ", "Eşleşen terimler: ")}{scenarioResult.scenario_template.matched_terms.length ? scenarioResult.scenario_template.matched_terms.join(', ') : translate("general memory review", "genel hafıza incelemesi")}</p>
              <details className="technical-details">
                <summary>{t('Analysis provenance', 'Analizin teknik kaydı')}</summary>
              <p className="muted-copy">{t("Packet:", "Paket:")}{scenarioResult.scenario_packet.schema_version} · {scenarioResult.scenario_packet.packet_id}{t(" · selected memory ", " · seçilen hafıza ")}{scenarioResult.scenario_packet.evidence_budget.selected_memory_count}{t(" · candidate snapshot ", " · aday anlık görüntüsü ")}{scenarioResult.scenario_packet.candidate_memory_snapshot.length}{t(" · artifacts ", " · kaynak ")}{scenarioResult.scenario_packet.evidence_budget.selected_artifact_count}
              </p>
              <p className="muted-copy">{t("Replay:", "Yeniden oynatma:")}{scenarioResult.scenario_packet.replay_contract.replay_mode}{t(" · writes ", " · yazma ")}{scenarioResult.scenario_packet.replay_contract.trusted_write_allowed ? t('Allowed', 'İzin verildi') : t('Blocked', 'Engellendi')}{t(" · forecasting ", " · öngörü ")}{scenarioResult.scenario_packet.replay_contract.forecasting_allowed ? t('Allowed', 'İzin verildi') : t('Blocked', 'Engellendi')}
              </p>
              <p className="muted-copy">{t("Stored run:", "Kayıtlı çalışma:")}{scenarioResult.scenario_run_id ?? translate("not persisted", "kaydedilmedi")}{t(" · input snapshot ", " · girdi anlık görüntüsü ")}{scenarioResult.scenario_packet.input_snapshot_hash.slice(0, 20)}…
              </p>
              </details>
              {scenarioResult.candidate_templates.length > 1 ? (
                <p className="table-secondary">{t("Also matched: ", "Diğer eşleşmeler: ")}{scenarioResult.candidate_templates.slice(1).map((template) => template.title).join(', ')}</p>
              ) : null}
            </div>
            {scenarioResult.uncertainty_notes.map((note) => <p key={note} className="muted-copy">{note}</p>)}
            {scenarioResult.impacted_memory.length === 0 ? (
              <EmptyState title={t('No impact path found', 'Etki yolu bulunamadı')} description={t('Add more sources or ask a scenario closer to current memory.', 'Daha fazla kaynak ekleyin veya mevcut hafızaya daha yakın bir senaryo sorun.')} />
            ) : (
              <div className="stack-sm">
                {scenarioResult.impacted_memory.map((item) => (
                  <article key={`${item.memory_type}-${item.memory_id}`} className="panel-subtle stack-sm">
                    <div className="timeline-card-head">
                      <p className="table-primary">{item.title_or_label}</p>
                      <p className="table-secondary">{t('Confidence', 'Güven')} {formatPercent(item.confidence_score)}</p>
                    </div>
                    <p className="table-secondary">{formatLabel(item.memory_type)} · {item.source_artifact_title}</p>
                    <p className="table-secondary">{t("Matched evidence terms: ", "Eşleşen kaynak terimleri: ")}{item.matched_terms.join(', ') || translate("scenario topic", "senaryo konusu")}</p>
                    <p className="muted-copy">{item.impact_reason}</p>
                    <p className="evidence-block">{item.evidence_excerpt}</p>
                    <Link className="text-button" to={`/memory/${item.memory_type}/${item.memory_id}`}>{t('Open memory object', 'Hafıza nesnesini aç')}</Link>
                  </article>
                ))}
              </div>
            )}
            <div className="panel-subtle stack-sm">
              <p className="section-label">{t('Questions Izge recommends before action', 'İzge’nin eylem öncesi önerdiği sorular')}</p>
              {scenarioResult.recommended_questions.map((question) => <p key={question} className="table-secondary">{question}</p>)}
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel title={t('Previous analyses', 'Önceki analizler')} description={t('Recheck an analysis to see whether its evidence has changed.', 'Kanıtların değişip değişmediğini görmek için bir analizi yeniden kontrol edin.')}>
        {scenarioRuns && scenarioRuns.runs.length > 0 ? (
          <div className="stack-md">
            <div className="stack-sm">
              {scenarioRuns.runs.map((run) => (
                <article key={run.scenario_run_id} className="panel-subtle stack-sm">
                  <div className="timeline-card-head">
                    <div>
                      <p className="section-label">{formatLabel(run.selected_template_key)} · {formatLabel(run.replay_verdict)}</p>
                      <p className="table-primary">{formatDateTime(run.created_at)}</p>
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void handleReplayScenario(run.scenario_run_id)}
                      disabled={replayingRunId === run.scenario_run_id}
                    >
                      {replayingRunId === run.scenario_run_id ? t('Replaying…', 'Yeniden oynatılıyor…') : t('Recheck evidence', 'Kanıtları yeniden kontrol et')}
                    </button>
                  </div>
                  <p className="table-secondary">{t("Selected", "Seçilen")}{run.selected_memory_count}{t(" of ", " / ")}{run.candidate_memory_count}{t(" candidate memory records", " aday hafıza kaydı")}
                  </p>
                  <details className="technical-details"><summary>{t('Analysis IDs', 'Teknik analiz kimlikleri')}</summary><p className="table-secondary">{run.scenario_run_id} · {run.packet_id}</p></details>
                </article>
              ))}
            </div>
            {scenarioReplay ? (
              <div className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <p className="table-primary">{t("Replay verdict: ", "Yeniden oynatma sonucu: ")}{formatLabel(scenarioReplay.verdict)}</p>
                  <StatusBadge value={scenarioReplay.input_snapshot_changed || scenarioReplay.candidate_snapshot_changed ? 'Changed' : 'Stable'} />
                </div>
                <p className="evidence-block">{scenarioReplay.summary}</p>
                <p className="table-secondary">{t("Kept", "Korunan")}{scenarioReplay.selected_memory_kept.length}{t(" · added ", " · eklenen ")}{scenarioReplay.selected_memory_added.length}{t(" · removed ", " · kaldırılan ")}{scenarioReplay.selected_memory_removed.length}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title={t('No scenario runs yet', 'Henüz senaryo çalışması yok')} description={t('Your scenario analyses will appear here.', 'Senaryo analizleriniz burada görünecek.')} />
        )}
      </Panel>
      <details className="technical-details">
        <summary>{t('Technical diagnostics', 'Teknik tanılama')}</summary>
        <p className="table-secondary">{t('Internal processing records for troubleshooting. These are not actions you need to complete.', 'Sorun giderme için dahili işlem kayıtları. Bunlar tamamlamanız gereken işler değildir.')}</p>
      <details className="employee-focus-details">
        <summary>{t('Raw runtime description', 'Ham çalışma zamanı açıklaması')}</summary>
        {blueprint ? <p className="evidence-block">{blueprint.current_runtime_note}</p> : <EmptyState title={t('Loading blueprint', 'Plan yükleniyor')} description={t('The system is preparing orchestration stage metadata.', 'Sistem orkestrasyon aşaması üst verisini hazırlıyor.')} />}
      </details>

      <details className="employee-focus-details">
        <summary>{t('Stage catalog', 'Aşama kataloğu')}</summary>
        {blueprint ? (
          <div className="stack-sm">
            {blueprint.stage_catalog.map((stage) => (
              <article key={stage.stage_key} className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <div>
                    <p className="section-label">{stage.agent_role}</p>
                    <p className="table-primary">{stage.title}</p>
                  </div>
                  <StatusBadge value={stage.status} />
                </div>
                <p className="muted-copy">{stage.purpose}</p>
                <div className="two-column-layout">
                  <div className="panel-subtle stack-sm">
                    <p className="section-label">{t('Inputs', 'Girdiler')}</p>
                    {stage.inputs.map((input) => <p key={input} className="table-secondary">{input}</p>)}
                  </div>
                  <div className="panel-subtle stack-sm">
                    <p className="section-label">{t('Outputs', 'Çıktılar')}</p>
                    {stage.outputs.map((output) => <p key={output} className="table-secondary">{output}</p>)}
                  </div>
                </div>
                <p className="evidence-block">{t('Gate', 'Kontrol')}: {stage.deterministic_gate}</p>
                <p className="table-secondary">{t('Authority', 'Yetki')}: {formatLabel(stage.authority_level)} · {t('Current reflection', 'Mevcut karşılık')}: {stage.current_reflection}</p>
              </article>
            ))}
          </div>
        ) : null}
      </details>

      <details className="employee-focus-details">
        <summary>{t('Delegation policy', 'Görevlendirme ilkesi')}</summary>
        {blueprint ? (
          <div className="stack-sm">
            {blueprint.spawn_policy.map((rule) => <p key={rule} className="evidence-block">{rule}</p>)}
          </div>
        ) : null}
      </details>

      <details className="employee-focus-details">
        <summary>{t('Stage-run history', 'Aşama çalışma geçmişi')}</summary>
        {stageRuns && stageRuns.runs.length > 0 ? (
          <div className="stack-sm">
            {stageRuns.runs.slice(0, 12).map((run) => (
              <article key={run.stage_run_id} className="panel-subtle stack-sm">
                <div className="timeline-card-head">
                  <div>
                    <p className="section-label">{formatLabel(run.stage_key)}</p>
                    <p className="table-primary">{run.query_run_id}</p>
                  </div>
                  <StatusBadge value={run.status} />
                </div>
                <p className="table-secondary">{t("Authority: ", "Yetki: ")}{formatLabel(run.authority_level)}{t(" · Verifier: ", " · Doğrulayıcı: ")}{run.verifier_status ? formatLabel(run.verifier_status) : t('Unavailable', 'Kullanılamıyor')}</p>
                <p className="muted-copy">{t("Context packet: ", "Bağlam paketi: ")}{String(run.input_refs.context_packet_id ?? translate("not recorded", "kaydedilmedi"))}</p>
                {run.input_refs.stage_packet_id ? (
                  <p className="muted-copy">{t("Stage packet:", "Aşama paketi:")}{String(run.input_refs.stage_packet_id)} · {String(run.output_summary.execution_model ?? translate("bounded stage", "sınırlı aşama"))}
                  </p>
                ) : null}
                <p className="evidence-block">{String(run.output_summary.reason ?? translate("No stage summary recorded.", "Aşama özeti yok."))}</p>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title={t('No stage runs yet', 'Henüz aşama çalışması yok')} description={t('Submit a query to create replayable bounded orchestration stage-run records.', 'Yeniden oynatılabilir sınırlı orkestrasyon kayıtları oluşturmak için bir sorgu gönderin.')} />
        )}
      </details>

      </details>
    </div>
  )
}

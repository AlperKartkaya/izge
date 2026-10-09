import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel, StatusBadge } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDate, formatDateTime, formatLabel, formatPercent } from '../lib/format'
import type { MemoryDetail } from '../lib/types'
import { useLanguage } from '../lib/i18n'

export function MemoryDetailPage() {
  const { t } = useLanguage()
  const { memoryType = '', memoryId = '' } = useParams()
  const { session } = useAuth()
  const [detail, setDetail] = useState<MemoryDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!session?.token || !memoryType || !memoryId) {
        return
      }

      try {
        const payload = await api.getMemoryDetail(session.token, memoryType, memoryId)
        if (!cancelled) {
          setDetail(payload)
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof ApiError ? caughtError.message : t('Unable to load memory detail.', 'Hafıza ayrıntısı yüklenemedi.'))
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [memoryId, memoryType, session?.token, t])

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow={t('Memory object detail', 'Hafıza nesnesi ayrıntısı')}
        title={t('Inspect the exact remembered claim', 'Hatırlanan ifadeyi ayrıntılı inceleyin')}
        description={t('Review the normalized memory object, its evidence span, and its source context independently from the result page.', 'Normalleştirilmiş hafıza nesnesini, kanıt aralığını ve kaynak bağlamını sonuç sayfasından bağımsız inceleyin.')}
        actions={
          <Link className="secondary-button" to="/query">{t("Back to history workspace", "Geçmiş çalışma alanına dön")}</Link>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      {!error && !detail ? (
        <EmptyState title={t('Loading memory detail', 'Hafıza ayrıntısı yükleniyor')} description={t('The requested memory object is being retrieved.', 'İstenen hafıza nesnesi getiriliyor.')} />
      ) : null}

      {detail ? (
        <Panel title={detail.title_or_label} description={`${detail.memory_type} · ${detail.memory_id}`}>
          <div className="stack-lg">
            <dl className="meta-list">
              <div>
                <dt>{t('Confidence', 'Güven')}</dt>
                <dd>{formatPercent(detail.confidence_score)}</dd>
              </div>
              <div>
                <dt>{t('Event timestamp', 'Olay zamanı')}</dt>
                <dd>{formatDateTime(detail.event_timestamp)}</dd>
              </div>
              <div>
                <dt>{t('Source artifact', 'Kaynak')}</dt>
                <dd>{detail.source_artifact_id}</dd>
              </div>
              <div>
                <dt>{t('Source review', 'Kaynak incelemesi')}</dt>
                <dd>
                  <StatusBadge value={detail.source_artifact_review_status} />
                </dd>
              </div>
              <div>
                <dt>{t('Source chunk', 'Kaynak bölümü')}</dt>
                <dd>{detail.source_chunk_id ?? t('Unavailable', 'Kullanılamıyor')}</dd>
              </div>
              {detail.status ? (
                <div>
                  <dt>{t('Status', 'Durum')}</dt>
                  <dd>{formatLabel(detail.status)}</dd>
                </div>
              ) : null}
              {detail.owner_label ? (
                <div>
                  <dt>{t('Owner', 'Sorumlu')}</dt>
                  <dd>{detail.owner_label}</dd>
                </div>
              ) : null}
              {detail.due_date ? (
                <div>
                  <dt>{t('Due date', 'Bitiş tarihi')}</dt>
                  <dd>{formatDate(detail.due_date)}</dd>
                </div>
              ) : null}
            </dl>

            <div className="panel-subtle">
              <p className="section-label">{t('Normalized text', 'Normalleştirilmiş metin')}</p>
              <p className="evidence-block">{detail.normalized_text}</p>
            </div>

            <div className="panel-subtle">
              <p className="section-label">{t('Evidence span', 'Kanıt aralığı')}</p>
              <p className="muted-copy">{detail.evidence_span ?? t('No explicit evidence span recorded.', 'Açık bir kanıt aralığı kaydedilmedi.')}</p>
            </div>

            <div className="panel-subtle stack-sm">
              <p className="section-label">{t('Extraction provenance', 'Çıkarım kaynağı')}</p>
              <p className="table-secondary">{t('Method', 'Yöntem')}: {formatLabel(detail.extraction_method)}</p>
              {detail.source_artifact_title ? <p className="table-secondary">{t('Artifact', 'Kaynak')}: {detail.source_artifact_title}</p> : null}
              {detail.source_chunk_excerpt ? <p className="muted-copy">{detail.source_chunk_excerpt}</p> : null}
              {detail.extraction_fallback_reason ? <p className="table-secondary">{t('Fallback', 'Yedek yöntem')}: {detail.extraction_fallback_reason}</p> : null}
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

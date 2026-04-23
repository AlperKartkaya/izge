import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, EmptyState, PageIntro, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { formatDateTime, formatPercent } from '../lib/format'
import type { MemoryDetail } from '../lib/types'

export function MemoryDetailPage() {
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
          setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to load memory detail.')
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [memoryId, memoryType, session?.token])

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Memory detail"
        title="Inspect structured memory output"
        description="This surface reads directly from `/api/memory/:type/:id` so evidence-backed objects can be reviewed independently from query output."
        actions={
          <Link className="secondary-button" to="/query">
            Back to query workspace
          </Link>
        }
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      {!error && !detail ? (
        <EmptyState title="Loading memory detail" description="The requested memory object is being retrieved from the backend." />
      ) : null}

      {detail ? (
        <Panel title={detail.title_or_label} description={`${detail.memory_type} · ${detail.memory_id}`}>
          <div className="stack-lg">
            <dl className="meta-list">
              <div>
                <dt>Confidence</dt>
                <dd>{formatPercent(detail.confidence_score)}</dd>
              </div>
              <div>
                <dt>Event timestamp</dt>
                <dd>{formatDateTime(detail.event_timestamp)}</dd>
              </div>
              <div>
                <dt>Source artifact</dt>
                <dd>{detail.source_artifact_id}</dd>
              </div>
              <div>
                <dt>Source chunk</dt>
                <dd>{detail.source_chunk_id ?? 'Unavailable'}</dd>
              </div>
            </dl>

            <div className="panel-subtle">
              <p className="section-label">Normalized text</p>
              <p className="evidence-block">{detail.normalized_text}</p>
            </div>

            <div className="panel-subtle">
              <p className="section-label">Evidence span</p>
              <p className="muted-copy">{detail.evidence_span ?? 'No explicit evidence span recorded.'}</p>
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  )
}

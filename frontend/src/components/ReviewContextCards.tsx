import { formatDateTime } from '../lib/format'
import type { AgentRunRead } from '../lib/types'
import { SourcePreviewButton } from './SourcePreviewButton'
import { AgentText } from './AgentPrimitives'

/* Adapted from beautiful-ui 10 Context Cards (MIT); only persisted review evidence is shown. */
export function ReviewContextCards({ review }: { review: AgentRunRead }) {
  return <div className="review-context-cards">
    <article className="review-context-card">
      <header><strong>Günün özeti ve öneriler</strong><time>{formatDateTime(review.updated_at)}</time></header>
      <div className="review-context-answer" tabIndex={0}><AgentText text={review.answer ?? ''} sources={review.sources} /></div>
      <footer><span className="review-context-chip"><span className="review-context-badge" aria-hidden="true">İZ</span>İzge’nin değerlendirmesi</span></footer>
    </article>
    {review.sources.length ? <section className="review-context-sources" aria-label="Değerlendirmenin bağlamı">
      <header><strong>Değerlendirmenin bağlamı</strong><span>{review.sources.length} kaynak</span></header>
      <div className="review-context-source-list">{review.sources.map((source) => <article className="review-context-card" key={`${source.artifact_id}-${source.chunk_id ?? ''}`}>
        <header><strong>{source.title}</strong><small>{source.quote.length.toLocaleString('tr-TR')} karakter</small></header>
        <p>{source.quote}</p>
        <footer><SourcePreviewButton artifactId={source.artifact_id} title={source.title} className="review-context-chip"><span className="review-context-badge" aria-hidden="true">↗</span>{source.title}</SourcePreviewButton></footer>
      </article>)}</div>
    </section> : null}
  </div>
}

import { formatDateTime } from '../lib/format'
import type { AgentRunRead } from '../lib/types'
import { SourcePreviewButton } from './SourcePreviewButton'
import { useLanguage } from '../lib/i18n'
import { currentLocale } from '../lib/language'
import { AgentText } from './AgentPrimitives'

/* Adapted from beautiful-ui 10 Context Cards (MIT); only persisted review evidence is shown. */
export function ReviewContextCards({ review }: { review: AgentRunRead }) {
  const { t } = useLanguage()
  return <div className="review-context-cards">
    <article className="review-context-card">
      <header><strong>{t("Daily recap and suggestions", "Günün özeti ve öneriler")}</strong><time>{formatDateTime(review.updated_at)}</time></header>
      <div className="review-context-answer" tabIndex={0}><AgentText text={review.answer ?? ''} sources={review.sources} /></div>
      <footer><span className="review-context-chip"><span className="review-context-badge" aria-hidden="true">İZ</span>{t("Izge’s review", "İzge’nin değerlendirmesi")}</span></footer>
    </article>
    {review.sources.length ? <section className="review-context-sources" aria-label={t("Review context", "Değerlendirmenin bağlamı")}>
      <header><strong>{t("Review context", "Değerlendirmenin bağlamı")}</strong><span>{review.sources.length} {t("sources", "kaynak")}</span></header>
      <div className="review-context-source-list">{review.sources.map((source) => <article className="review-context-card" key={`${source.artifact_id}-${source.chunk_id ?? ''}`}>
        <header><strong>{source.title}</strong><small>{source.quote.length.toLocaleString(currentLocale())} {t("characters", "karakter")}</small></header>
        <div className="review-context-excerpt markdown-content"><AgentText text={source.quote} /></div>
        <footer><SourcePreviewButton artifactId={source.artifact_id} title={source.title} className="review-context-chip"><span className="review-context-badge" aria-hidden="true">↗</span>{source.title}</SourcePreviewButton></footer>
      </article>)}</div>
    </section> : null}
  </div>
}

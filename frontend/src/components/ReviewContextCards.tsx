import { formatDateTime } from '../lib/format'
import type { AgentRunRead } from '../lib/types'
import { SourcePreviewButton } from './SourcePreviewButton'
import { useLanguage } from '../lib/i18n'
import { currentLocale } from '../lib/language'
import { compactMarkdownPreview } from '../lib/agentText'
import { AgentText } from './AgentPrimitives'

/* Adapted from beautiful-ui 10 Context Cards (MIT); only persisted review evidence is shown. */
export function ReviewContextCards({ review }: { review: AgentRunRead }) {
  const { t } = useLanguage()
  return <div className="review-context-cards">
    <details className="review-context-details">
      <summary><span><strong>{t("Daily recap and suggestions", "Günün özeti ve öneriler")}</strong><small>{compactMarkdownPreview(review.answer ?? '', 140)}</small></span><span><time>{formatDateTime(review.updated_at)}</time><small>{review.sources.length} {t('sources', 'kaynak')}</small></span></summary>
      <div className="review-context-answer"><AgentText text={review.answer ?? ''} sources={review.sources} /></div>
    </details>
    {review.sources.length ? <section className="review-context-sources" aria-label={t("Review context", "Değerlendirmenin bağlamı")}>
      <header><strong>{t("Review context", "Değerlendirmenin bağlamı")}</strong><span>{review.sources.length} {t("sources", "kaynak")}</span></header>
      <div className="review-context-source-list">{review.sources.map((source) => <details className="review-context-source" key={`${source.artifact_id}-${source.chunk_id ?? ''}`}>
        <summary><strong>{source.title}</strong><small>{source.quote.length.toLocaleString(currentLocale())} {t("characters", "karakter")}</small></summary>
        <div className="review-context-excerpt markdown-content"><AgentText text={source.quote} /></div>
        <SourcePreviewButton artifactId={source.artifact_id} title={source.title} className="review-context-chip">{t('Open source', 'Kaynağı aç')}</SourcePreviewButton>
      </details>)}</div>
    </section> : null}
  </div>
}

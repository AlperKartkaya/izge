import { useState, type FormEventHandler } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, PageIntro, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { starterPrompts } from '../lib/demo'

export function QueryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { session } = useAuth()
  const promptFromUrl = searchParams.get('prompt') || starterPrompts[0]
  const [queryDraft, setQueryDraft] = useState({ sourcePrompt: promptFromUrl, text: promptFromUrl })
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const queryText = queryDraft.sourcePrompt === promptFromUrl ? queryDraft.text : promptFromUrl

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    if (!session?.token) {
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const result = await api.submitQuery(session.token, queryText)
      navigate(`/query/${result.query_run_id}`, { state: { result } })
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Unable to submit query.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="stack-xl">
      <PageIntro
        eyebrow="Company questions"
        title="Ask for evidence-backed answers"
        description="Write the question in plain language. Izge routes it into a fixed memory-analysis mode so the response stays grounded in permitted artifacts and memory records."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <div className="two-column-layout">
        <Panel title="Question" description="The system compares stored decisions, assumptions, constraints, outcomes, and commitments against later evidence and returns an inspectable reasoning path.">
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field field-block">
              <span className="field-label">Question</span>
              <textarea
                value={queryText}
                onChange={(event) => setQueryDraft({ sourcePrompt: promptFromUrl, text: event.target.value })}
                rows={10}
                minLength={3}
                required
              />
            </label>
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting…' : 'Generate answer'}
            </button>
          </form>
        </Panel>

        <Panel title="Starter questions" description="Use these to exercise lineage, contradiction, assumption drift, and next-action retrieval against the current workspace.">
          <div className="signal-grid">
            {starterPrompts.map((prompt) => (
              <button key={prompt} type="button" className="prompt-card" onClick={() => setQueryDraft({ sourcePrompt: promptFromUrl, text: prompt })}>
                {prompt}
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

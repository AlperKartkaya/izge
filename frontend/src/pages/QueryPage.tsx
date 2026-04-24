import { useState, type FormEventHandler } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Callout, PageIntro, Panel } from '../components/ui'
import { api, ApiError } from '../lib/api'

const starterPrompts = [
  'What was decided about onboarding prioritization and why?',
  'Which recent roadmap notes contradict earlier commitments?',
  'Which assumptions about activation now look stale?',
  'What should the team do next based on unresolved commitments?',
]

export function QueryPage() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const [queryText, setQueryText] = useState(starterPrompts[0])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

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
        eyebrow="Ask the history"
        title="Reconstruct what happened and what to do next"
        description="Write the question in plain language. Izge routes it into a fixed memory-analysis mode so the response stays evidence-backed instead of drifting into chat."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <div className="two-column-layout">
        <Panel title="Historical question" description="Use plain language. Izge determines whether the question is about lineage, contradiction, stale assumptions, or next actions.">
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field field-block">
              <span className="field-label">Question</span>
              <textarea value={queryText} onChange={(event) => setQueryText(event.target.value)} rows={10} minLength={3} required />
            </label>
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting…' : 'Reconstruct answer'}
            </button>
          </form>
        </Panel>

        <Panel title="Memory-analysis modes" description="Starter questions stay anchored to the locked MVP modes so the workflow reads as institutional reasoning, not generic search.">
          <div className="signal-grid">
            {starterPrompts.map((prompt) => (
              <button key={prompt} type="button" className="prompt-card" onClick={() => setQueryText(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

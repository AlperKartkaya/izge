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
        eyebrow="Query workspace"
        title="Run a historical analysis"
        description="Natural language prompts are classified into the MVP’s four query classes before the backend composes an evidence-backed response."
      />

      {error ? <Callout tone="warning">{error}</Callout> : null}

      <div className="two-column-layout">
        <Panel title="Query input" description="Use plain language. The backend determines whether this is lineage, contradiction, drift, or next-action analysis.">
          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field field-block">
              <span className="field-label">Question</span>
              <textarea value={queryText} onChange={(event) => setQueryText(event.target.value)} rows={10} minLength={3} required />
            </label>
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting…' : 'Run analysis'}
            </button>
          </form>
        </Panel>

        <Panel title="Contract-defined modes" description="The UI avoids chat framing by keeping query intent tied to the locked analytical modes.">
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

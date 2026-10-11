import { useLanguage } from '../lib/i18n'
import type { AgentModelProfileId } from '../lib/types'
import type { useAgentControls } from './useAgentControls'

type Controls = ReturnType<typeof useAgentControls>

export function AgentControls({ controls, disabled = false }: { controls: Controls; disabled?: boolean }) {
  const { t } = useLanguage()
  if (!controls.catalog) return controls.loadError ? <small className="agent-controls-status">{t('Model choices could not be loaded; the default will be used.', 'Model seçenekleri yüklenemedi; varsayılan kullanılacak.')}</small> : null
  const tools = controls.catalog.tools ?? { web_search: false, mcp: false, reviewer: false }
  const externalToolsAvailable = tools.web_search || tools.mcp
  return (
    <fieldset className="agent-controls" disabled={disabled}>
      <legend className="sr-only">{t('Izge work settings', 'İzge çalışma ayarları')}</legend>
      <label><span>{t('Model', 'Model')}</span><select value={controls.modelProfile} onChange={(event) => controls.setModelProfile(event.target.value as AgentModelProfileId)}>{!controls.modelProfile ? <option value="">{t('No configured model', 'Yapılandırılmış model yok')}</option> : null}{controls.catalog.profiles.map((profile) => <option key={profile.id} value={profile.id} disabled={!profile.enabled}>{profile.label}{profile.enabled ? '' : ` — ${profile.reason ?? t('Not configured', 'Yapılandırılmadı')}`}</option>)}</select></label>
      {controls.selected?.supported_efforts.some((effort) => effort !== 'none') ? <label><span>{t('Effort', 'Efor')}</span><select value={controls.reasoningEffort ?? ''} onChange={(event) => controls.setReasoningEffort(event.target.value)}><option value="">{t('Default', 'Varsayılan')}</option>{controls.selected.supported_efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}</select></label> : null}
      <label className="agent-control-check" title={!externalToolsAvailable ? t('External tools are not configured.', 'Harici araçlar yapılandırılmadı.') : undefined}><input type="checkbox" checked={controls.allowExternalTools} disabled={disabled || !externalToolsAvailable} onChange={(event) => controls.setAllowExternalTools(event.target.checked)} /><span>{t('External tools', 'Harici araçlar')}</span></label>
      {tools.reviewer ? <label className="agent-control-check"><input type="checkbox" checked={controls.requestReviewer} onChange={(event) => controls.setRequestReviewer(event.target.checked)} /><span>{t('Reviewer', 'İnceleyici')}</span></label> : null}
      {controls.allowExternalTools && tools.web_search ? <small className="agent-controls-warning">{t('The public search query is sent to the web provider.', 'Herkese açık arama sorgusu web sağlayıcısına gönderilir.')}</small> : null}
      {controls.selected?.data_boundary === 'cloud' ? <small className="agent-controls-warning">{t('The prompt and selected context are sent to the cloud model provider.', 'İstem ve seçilen bağlam bulut model sağlayıcısına gönderilir.')}</small> : null}
    </fieldset>
  )
}

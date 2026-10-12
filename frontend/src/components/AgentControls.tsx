import { ButtonIcon } from './ButtonIcon'
import { useLanguage } from '../lib/i18n'
import type { AgentModelProfileId } from '../lib/types'
import type { useAgentControls } from './useAgentControls'
import { Select } from './Select'

type Controls = ReturnType<typeof useAgentControls>

function effortLabel(effort: string, t: (english: string, turkish: string) => string) {
  return ({ none: t('None', 'Kapalı'), max: t('Maximum', 'En yüksek'), low: t('Low', 'Düşük'), medium: t('Medium', 'Orta'), high: t('High', 'Yüksek'), xhigh: t('Extra high', 'Çok yüksek') } as Record<string, string>)[effort] ?? effort
}

export function AgentControls({ controls, disabled = false }: { controls: Controls; disabled?: boolean }) {
  const { t } = useLanguage()
  if (!controls.catalog) return controls.loadError ? <small className="agent-controls-status">{t('Model choices could not be loaded; the default will be used.', 'Model seçenekleri yüklenemedi; varsayılan kullanılacak.')}</small> : null
  return (
    <>
    <details className="agent-settings">
      <summary>{t('Response settings', 'Yanıt ayarları')}</summary>
    <fieldset className="agent-controls" disabled={disabled}>
      <legend className="sr-only">{t('Izge work settings', 'İzge çalışma ayarları')}</legend>
      <label><span>{t('Model', 'Model')}</span><Select aria-label={t('Model', 'Model')} value={controls.modelProfile} disabled={disabled} onValueChange={(value) => controls.setModelProfile(value as AgentModelProfileId)} options={[...(!controls.modelProfile ? [{ value: '', label: t('No configured model', 'Yapılandırılmış model yok') }] : []), ...controls.catalog.profiles.map((profile) => ({ value: profile.id, label: `${profile.label}${profile.enabled ? '' : ` — ${profile.reason ?? t('Not configured', 'Yapılandırılmadı')}`}`, disabled: !profile.enabled }))]} /></label>
      {controls.selected?.supported_efforts.some((effort) => effort !== 'none') ? <label><span>{t('Effort', 'Efor')}</span><Select aria-label={t('Effort', 'Efor')} value={controls.reasoningEffort ?? ''} disabled={disabled} onValueChange={controls.setReasoningEffort} options={[{ value: '', label: t('Default', 'Varsayılan') }, ...controls.selected.supported_efforts.map((effort) => ({ value: effort, label: effortLabel(effort, t) }))]} /></label> : null}
    </fieldset>
    </details>
    {controls.selected?.data_boundary === 'cloud' ? <small className="agent-controls-warning">{t('The prompt and selected context are sent to the cloud model provider.', 'İstem ve seçilen bağlam bulut model sağlayıcısına gönderilir.')}</small> : null}
    </>
  )
}

export function AgentToolMenu({ controls, disabled, onSelect }: { controls: Controls; disabled?: boolean; onSelect: () => void }) {
  const { t } = useLanguage()
  const tools = controls.catalog?.tools
  const web = controls.webSearchAvailable
  const mcp = tools?.mcp === true
  return <>
    <strong>{t('Tools', 'Araçlar')}</strong>
    <button type="button" role="menuitemcheckbox" aria-checked={controls.allowExternalTools} disabled={disabled || !(web || mcp)} onClick={() => { controls.setAllowExternalTools(!controls.allowExternalTools); onSelect() }}>
      <ButtonIcon name="search" /><span>{web ? t('Web search', 'Web araması') : mcp ? t('Company tools', 'Şirket araçları') : t('Web search', 'Web araması')}<small>{web ? t('Search the web when needed', 'Gerektiğinde web’de ara') : mcp ? t('Read connected company tools', 'Bağlı şirket araçlarını oku') : t('Not supported or configured for this model', 'Bu model için desteklenmiyor veya yapılandırılmadı')}</small></span>
    </button>
    {tools?.reviewer ? <button type="button" role="menuitemcheckbox" aria-checked={controls.requestReviewer} disabled={disabled} onClick={() => { controls.setRequestReviewer(!controls.requestReviewer); onSelect() }}><ButtonIcon name="audit" /><span>{t('Reviewer', 'İnceleyici')}<small>{t('Have a reviewer check the response', 'Yanıtı bir inceleyici kontrol etsin')}</small></span></button> : null}
  </>
}

export function AgentToolChips({ controls, disabled }: { controls: Controls; disabled?: boolean }) {
  const { t } = useLanguage()
  return <>
    {controls.allowExternalTools ? <button type="button" className="agent-tool-chip" disabled={disabled} onClick={() => controls.setAllowExternalTools(false)} title={t('Remove external tools', 'Harici araçları kaldır')}><ButtonIcon name="search" />{controls.webSearchAvailable ? t('Web search', 'Web araması') : t('Company tools', 'Şirket araçları')}<span aria-hidden="true">×</span></button> : null}
    {controls.requestReviewer ? <button type="button" className="agent-tool-chip" disabled={disabled} onClick={() => controls.setRequestReviewer(false)} title={t('Remove reviewer', 'İnceleyiciyi kaldır')}><ButtonIcon name="audit" />{t('Reviewer', 'İnceleyici')}<span aria-hidden="true">×</span></button> : null}
  </>
}

import * as Progress from '@radix-ui/react-progress'
import { progressPercent } from '../lib/progress'
import { useLanguage } from '../lib/i18n'

export function ProgressMeter({ value, label, detail }: { value: number | null; label: string; detail?: string }) {
  const { language } = useLanguage()
  const percent = progressPercent(value)
  const valueLabel = percent === null ? '—' : new Intl.NumberFormat(language, { style: 'percent' }).format(percent / 100)
  return <span className="progress-meter">
    <span className="progress-meter-label"><span>{label}</span><span>{detail ?? valueLabel}</span></span>
    <Progress.Root asChild value={percent} aria-label={label} getValueLabel={() => detail ?? valueLabel}>
      <span className="progress-track"><Progress.Indicator asChild><span className="progress-fill" style={{ transform: `translateX(-${100 - (percent ?? 0)}%)` }} /></Progress.Indicator></span>
    </Progress.Root>
  </span>
}

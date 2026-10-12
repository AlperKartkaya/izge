import type { WorkTaskStatus } from './types'
import { translate, type Language } from './language.ts'

const taskStatusCycle: Record<WorkTaskStatus, WorkTaskStatus> = {
  open: 'in_progress',
  in_progress: 'done',
  done: 'open',
}

export function nextTaskStatus(status: WorkTaskStatus) {
  return taskStatusCycle[status]
}

export function splitTasksByCompletion<T extends { status: WorkTaskStatus }>(tasks: T[]) {
  return {
    active: tasks.filter((task) => task.status !== 'done'),
    completed: tasks.filter((task) => task.status === 'done'),
  }
}

export function taskStatusLabel(status: WorkTaskStatus, language: Language) {
  if (status === 'open') return translate('Open', 'Açık', language)
  if (status === 'in_progress') return translate('In progress', 'Devam ediyor', language)
  return translate('Completed', 'Tamamlandı', language)
}

export function taskStatusAction(title: string, status: WorkTaskStatus, language: Language) {
  if (status === 'open') return translate(`Start ${title}`, `${title} görevini başlat`, language)
  if (status === 'in_progress') return translate(`Complete ${title}`, `${title} görevini tamamla`, language)
  return translate(`Reopen ${title}`, `${title} görevini yeniden aç`, language)
}

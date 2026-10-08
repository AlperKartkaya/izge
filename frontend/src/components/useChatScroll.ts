import { useLayoutEffect, useRef } from 'react'
import { isNearChatBottom } from '../lib/chatScroll'

export function useChatScroll(threadId: string, contentKey: string) {
  const ref = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const previousThread = useRef(threadId)

  useLayoutEffect(() => {
    if (previousThread.current !== threadId) following.current = true
    previousThread.current = threadId
    // Scroll this panel only; never move the document or interrupt reading history.
    if (following.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [threadId, contentKey])

  return {
    ref,
    onScroll: () => { if (ref.current) following.current = isNearChatBottom(ref.current) },
    followLatest: () => { following.current = true },
  }
}

export function isNearChatBottom({ scrollHeight, scrollTop, clientHeight }: {
  scrollHeight: number; scrollTop: number; clientHeight: number
}) {
  return scrollHeight - scrollTop - clientHeight <= 64
}

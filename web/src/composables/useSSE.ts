import { ref } from 'vue'

/**
 * 通用 SSE 解析器
 * 处理 fetch ReadableStream 中的 SSE data: 行、心跳行、跨 chunk 的 partial data
 */
export function useSSE() {
  const isStreaming = ref(false)
  let abortCtrl: AbortController | null = null

  async function start(
    url: string,
    body: Record<string, unknown>,
    onEvent: (event: any) => void,
    method: string = 'POST'
  ): Promise<void> {
    abortCtrl = new AbortController()
    isStreaming.value = true
    let buffer = ''

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortCtrl.signal,
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(err || `HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // 按 \n\n 分割完整的 SSE 事件
        const parts = buffer.split('\n\n')
        // 最后一部分可能不完整，保留在 buffer 中
        buffer = parts.pop() || ''

        for (const part of parts) {
          const lines = part.split('\n')
          for (const line of lines) {
            if (line.startsWith(': ')) continue  // 心跳，跳过
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6))
                onEvent(event)
              } catch {
                // 解析失败跳过
              }
            }
          }
        }
      }

      // 处理 buffer 中剩余的数据
      if (buffer.trim()) {
        for (const line of buffer.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))
              onEvent(event)
            } catch { /* skip */ }
          }
        }
      }
    } finally {
      isStreaming.value = false
      abortCtrl = null
    }
  }

  function abort() {
    abortCtrl?.abort()
    isStreaming.value = false
  }

  return { isStreaming, start, abort }
}

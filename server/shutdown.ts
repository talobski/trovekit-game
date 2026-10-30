import type { Server } from "node:http"

/** Stop accepting work, drain HTTP responses, then close idle/stalled clients. */
export function shutdownServer(server: Server, stop: () => void, destroy: () => void, timeoutMs = 5000): Promise<void> {
  stop()
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(destroy, timeoutMs)
    deadline.unref()
    server.close(error => {
      clearTimeout(deadline)
      if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") reject(error)
      else resolve()
    })
    server.closeIdleConnections()
  })
}

export function installShutdown(close: () => Promise<void>) {
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    void close().catch(error => { console.error("Shutdown failed", error); process.exitCode = 1 })
  }
  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
}

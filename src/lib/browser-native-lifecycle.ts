/** Serializes native browser visibility transitions and coalesces redundant close requests. */
export class BrowserNativeLifecycle {
  #tail: Promise<void> = Promise.resolve()
  #releaseQueued: Promise<void> | null = null
  #released = false

  activate(operation: () => Promise<void>): Promise<void> {
    // A later release must be allowed to queue behind this activation instead of joining an older
    // release that is already ahead of it.
    this.#released = false
    this.#releaseQueued = null
    return this.#enqueue(async () => {
      await operation()
      this.#released = false
    })
  }

  release(operation: () => Promise<void>): Promise<void> {
    if (this.#released) return Promise.resolve()
    if (this.#releaseQueued) return this.#releaseQueued
    const request = this.#enqueue(async () => {
      if (this.#released) return
      await operation()
      this.#released = true
    })
    this.#releaseQueued = request
    const clear = () => {
      if (this.#releaseQueued === request) this.#releaseQueued = null
    }
    void request.then(clear, clear)
    return request
  }

  #enqueue(operation: () => Promise<void>): Promise<void> {
    const request = this.#tail.then(operation, operation)
    this.#tail = request.catch(() => {})
    return request
  }
}

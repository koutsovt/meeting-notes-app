import { describe, it, expect, vi, afterEach } from "vitest"
import { createCaptureService } from "../modules/capture/index.js"
import type { AudioChunk } from "../shared/types/audio.js"

describe("CaptureService", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // --- basic start/stop ---

  it("starts and stops capturing", () => {
    vi.useFakeTimers()
    const service = createCaptureService()
    const chunks: AudioChunk[] = []

    service.start("m-1", (chunk) => chunks.push(chunk))
    expect(service.isCapturing()).toBe(true)

    vi.advanceTimersByTime(5000)
    expect(chunks).toHaveLength(1)

    vi.advanceTimersByTime(5000)
    expect(chunks).toHaveLength(2)

    service.stop()
    expect(service.isCapturing()).toBe(false)

    vi.advanceTimersByTime(10000)
    expect(chunks).toHaveLength(2)
  })

  // --- source types ---

  it("defaults to microphone source", () => {
    vi.useFakeTimers()
    const service = createCaptureService()
    const chunks: AudioChunk[] = []

    service.start("m-1", (chunk) => chunks.push(chunk))
    vi.advanceTimersByTime(5000)

    expect(chunks[0].source).toBe("microphone")
    service.stop()
  })

  it("emits system source when configured", () => {
    vi.useFakeTimers()
    const service = createCaptureService("system")
    const chunks: AudioChunk[] = []

    service.start("m-1", (chunk) => chunks.push(chunk))
    vi.advanceTimersByTime(5000)

    expect(chunks[0].source).toBe("system")
    service.stop()
  })

  // --- chunk metadata correctness ---

  it("emits chunks with correct timing metadata", () => {
    vi.useFakeTimers()
    const service = createCaptureService()
    const chunks: AudioChunk[] = []

    service.start("m-1", (chunk) => chunks.push(chunk))
    vi.advanceTimersByTime(15000)
    service.stop()

    expect(chunks).toHaveLength(3)

    expect(chunks[0].sequence).toBe(0)
    expect(chunks[0].startTimeMs).toBe(0)
    expect(chunks[0].endTimeMs).toBe(5000)

    expect(chunks[1].sequence).toBe(1)
    expect(chunks[1].startTimeMs).toBe(5000)
    expect(chunks[1].endTimeMs).toBe(10000)

    expect(chunks[2].sequence).toBe(2)
    expect(chunks[2].startTimeMs).toBe(10000)
    expect(chunks[2].endTimeMs).toBe(15000)
  })

  it("emits chunks with all required AudioChunk fields", () => {
    vi.useFakeTimers()
    const service = createCaptureService()
    const chunks: AudioChunk[] = []

    service.start("m-1", (chunk) => chunks.push(chunk))
    vi.advanceTimersByTime(5000)
    service.stop()

    const chunk = chunks[0]
    expect(typeof chunk.id).toBe("string")
    expect(chunk.id.length).toBeGreaterThan(0)
    expect(chunk.meetingId).toBe("m-1")
    expect(chunk.sequence).toBe(0)
    expect(chunk.source).toBe("microphone")
    expect(typeof chunk.createdAt).toBe("string")
    expect(new Date(chunk.createdAt).toISOString()).toBe(chunk.createdAt)
  })

  it("generates unique ids per chunk", () => {
    vi.useFakeTimers()
    const service = createCaptureService()
    const chunks: AudioChunk[] = []

    service.start("m-1", (chunk) => chunks.push(chunk))
    vi.advanceTimersByTime(15000)
    service.stop()

    const ids = chunks.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // --- error handling ---

  it("throws when starting while already capturing", () => {
    vi.useFakeTimers()
    const service = createCaptureService()
    const noop = () => {}

    service.start("m-1", noop)
    expect(() => service.start("m-2", noop)).toThrow("Capture already in progress")

    service.stop()
  })

  it("throws when stopping while not capturing", () => {
    const service = createCaptureService()
    expect(() => service.stop()).toThrow("Capture is not in progress")
  })

  it("throws on double stop", () => {
    vi.useFakeTimers()
    const service = createCaptureService()

    service.start("m-1", () => {})
    service.stop()
    expect(() => service.stop()).toThrow("Capture is not in progress")
  })

  it("continues emitting after chunk handler throws", () => {
    vi.useFakeTimers()
    const service = createCaptureService()
    const chunks: AudioChunk[] = []
    let callCount = 0

    service.start("m-1", (chunk) => {
      callCount++
      if (callCount === 1) throw new Error("handler error")
      chunks.push(chunk)
    })

    vi.advanceTimersByTime(5000)
    expect(callCount).toBe(1)

    vi.advanceTimersByTime(5000)
    expect(callCount).toBe(2)
    expect(chunks).toHaveLength(1)

    service.stop()
  })

  // --- stats ---

  it("tracks stats during capture", () => {
    vi.useFakeTimers()
    const service = createCaptureService("system")

    const stats = service.getStats()
    expect(stats.chunksEmitted).toBe(0)
    expect(stats.startedAt).toBeNull()
    expect(stats.source).toBe("system")

    service.start("m-1", () => {})
    vi.advanceTimersByTime(15000)

    const active = service.getStats()
    expect(active.chunksEmitted).toBe(3)
    expect(active.startedAt).not.toBeNull()
    expect(active.elapsedMs).toBe(15000)

    service.stop()
  })

  // --- restart ---

  it("resets sequence on restart", () => {
    vi.useFakeTimers()
    const service = createCaptureService()
    const chunks: AudioChunk[] = []

    service.start("m-1", (chunk) => chunks.push(chunk))
    vi.advanceTimersByTime(10000)
    service.stop()

    expect(chunks).toHaveLength(2)
    expect(chunks[1].sequence).toBe(1)

    service.start("m-2", (chunk) => chunks.push(chunk))
    vi.advanceTimersByTime(5000)
    service.stop()

    expect(chunks).toHaveLength(3)
    expect(chunks[2].sequence).toBe(0)
    expect(chunks[2].meetingId).toBe("m-2")
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createSpeechBuffer } from "../adapters/speech-buffer.js"

// Mock SpeechRecognition
class MockSpeechRecognition {
  continuous = false
  interimResults = false
  lang = ""
  onresult: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  started = false
  start() { this.started = true }
  stop() { this.started = false }
}

beforeEach(() => {
  vi.stubGlobal("SpeechRecognition", MockSpeechRecognition)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("SpeechBuffer", () => {
  it("starts and stops", () => {
    const buffer = createSpeechBuffer()
    expect(buffer.isRunning()).toBe(false)
    buffer.start()
    expect(buffer.isRunning()).toBe(true)
    buffer.stop()
    expect(buffer.isRunning()).toBe(false)
  })

  it("returns empty text for empty range", () => {
    const buffer = createSpeechBuffer()
    buffer.start()
    const result = buffer.getTextForRange(0, 5000)
    expect(result.text).toBe("")
    expect(result.confidence).toBe(0)
    buffer.stop()
  })

  it("clears the buffer", () => {
    const buffer = createSpeechBuffer()
    buffer.start()
    buffer.clear()
    const result = buffer.getTextForRange(0, 5000)
    expect(result.text).toBe("")
    buffer.stop()
  })

  it("does not crash when SpeechRecognition is unavailable", () => {
    vi.stubGlobal("SpeechRecognition", undefined)
    vi.stubGlobal("webkitSpeechRecognition", undefined)
    const buffer = createSpeechBuffer()
    expect(() => buffer.start()).not.toThrow()
    expect(buffer.isRunning()).toBe(true)
    buffer.stop()
  })

  it("returns real confidence from speech results", () => {
    const instances: MockSpeechRecognition[] = []
    const OrigMock = MockSpeechRecognition
    vi.stubGlobal("SpeechRecognition", class extends OrigMock {
      constructor() {
        super()
        instances.push(this)
      }
    })

    const buffer = createSpeechBuffer()
    buffer.start()

    const instance = instances[instances.length - 1]
    instance.onresult?.({
      resultIndex: 0,
      results: [{
        isFinal: true,
        0: { transcript: "hello world", confidence: 0.92 },
        length: 1,
      }],
    } as unknown)

    const result = buffer.getTextForRange(0, 60000)
    expect(result.text).toBe("hello world")
    expect(result.confidence).toBeCloseTo(0.92, 1)

    buffer.stop()
  })
})

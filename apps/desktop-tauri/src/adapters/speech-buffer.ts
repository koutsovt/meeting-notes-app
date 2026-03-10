/**
 * Shared speech recognition buffer.
 * Runs the Web Speech API and buffers recognized text with timestamps.
 * Capture starts/stops it; transcription reads from it.
 */

interface BufferedResult {
  text: string
  timestampMs: number
  confidence: number
}

export interface SpeechBuffer {
  start(): void
  stop(): void
  getTextForRange(startMs: number, endMs: number): { text: string; confidence: number }
  clear(): void
  isRunning(): boolean
  onInterim: ((text: string) => void) | null
}

export function createSpeechBuffer(): SpeechBuffer {
  let recognition: SpeechRecognition | null = null
  let buffer: BufferedResult[] = []
  let startEpochMs = 0
  let running = false
  let interimText = ""

  function getSpeechRecognition(): SpeechRecognition | null {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) return null
    return new SR()
  }

  function flushInterim(): void {
    if (interimText) {
      buffer.push({
        text: interimText,
        timestampMs: Date.now() - startEpochMs,
        confidence: 0.5,
      })
      interimText = ""
    }
  }

  const sb: SpeechBuffer = {
    onInterim: null,

    start(): void {
      if (running) return
      buffer = []
      startEpochMs = Date.now()

      running = true

      recognition = getSpeechRecognition()
      if (!recognition) {
        console.warn("SpeechRecognition not available — text will show (no speech detected)")
        return
      }

      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = "en-US"

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0].transcript.trim()
          const confidence = event.results[i][0].confidence

          if (event.results[i].isFinal) {
            interimText = ""
            if (text) {
              buffer.push({
                text,
                timestampMs: Date.now() - startEpochMs,
                confidence,
              })
            }
          } else {
            interimText = text
            sb.onInterim?.(text)
          }
        }
      }

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error === "no-speech") return
        console.warn("SpeechRecognition error:", event.error)
      }

      recognition.onend = () => {
        // Flush any pending interim text before restart to avoid gaps
        flushInterim()
        if (running && recognition) {
          recognition.start()
        }
      }

      recognition.start()
    },

    stop(): void {
      running = false
      flushInterim()
      if (recognition) {
        recognition.onend = null
        recognition.stop()
        recognition = null
      }
    },

    getTextForRange(startMs: number, endMs: number): { text: string; confidence: number } {
      const matches = buffer.filter(
        (r) => r.timestampMs >= startMs && r.timestampMs < endMs
      )
      const text = matches.map((r) => r.text).join(" ")
      const avgConfidence = matches.length > 0
        ? matches.reduce((sum, r) => sum + r.confidence, 0) / matches.length
        : 0
      return {
        text: text || "(no speech detected)",
        confidence: avgConfidence,
      }
    },

    clear(): void {
      buffer = []
    },

    isRunning(): boolean {
      return running
    },
  }

  return sb
}

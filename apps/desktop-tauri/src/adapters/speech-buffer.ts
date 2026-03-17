/**
 * Shared speech recognition buffer.
 * Runs the Web Speech API and buffers recognized text with timestamps.
 * Capture starts/stops it; transcription reads from it.
 *
 * iOS WKWebView: webkitSpeechRecognition is supported but stops frequently.
 * This implementation creates fresh instances on restart for reliability.
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

  function wireRecognition(rec: SpeechRecognition): void {
    rec.continuous = true
    rec.interimResults = true
    rec.lang = "en-US"

    rec.onresult = (event: SpeechRecognitionEvent) => {
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

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") return
      // On iOS, errors can stop recognition — schedule restart
      if (running) {
        setTimeout(() => { if (running) restartRecognition() }, 300)
      }
    }

    rec.onend = () => {
      flushInterim()
      // iOS WKWebView stops recognition frequently — always restart
      if (running) {
        setTimeout(() => { if (running) restartRecognition() }, 100)
      }
    }
  }

  function restartRecognition(): void {
    if (recognition) {
      try {
        recognition.onend = null
        recognition.onerror = null
        recognition.stop()
      } catch {
        // ignore
      }
      recognition = null
    }

    recognition = getSpeechRecognition()
    if (!recognition) return

    wireRecognition(recognition)

    try {
      recognition.start()
    } catch {
      setTimeout(() => { if (running) restartRecognition() }, 500)
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
        console.warn("SpeechRecognition not available")
        return
      }

      wireRecognition(recognition)
      recognition.start()
    },

    stop(): void {
      running = false
      flushInterim()
      if (recognition) {
        recognition.onend = null
        recognition.onerror = null
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
        text,
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

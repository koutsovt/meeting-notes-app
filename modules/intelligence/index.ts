import { v4 as uuid } from "uuid"
import { stream } from "@kenkaiiii/gg-ai"
import type { IntelligenceService } from "../../shared/services/intelligence-service.js"
import type { Transcript, TranscriptChunk } from "../../shared/types/transcript.js"
import type { MeetingSummary, ActionItem, Decision, LiveNote } from "../../shared/types/summary.js"

export interface AnalysisResult {
  title: string
  overview: string
  actionItems: ActionItem[]
  decisions: Decision[]
  keyPoints: string[]
}

export interface SummaryBackend {
  analyze(transcript: Transcript): Promise<AnalysisResult>
}

const ACTION_PATTERN = /\b(should|need to|must|action|will do|todo|assign|responsible for)\b/i
const DECISION_PATTERN = /\b(decided|agreed|approved|confirmed|concluded|resolved)\b/i
const QUESTION_PATTERN = /\?/

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function generateTitle(sentences: string[]): string {
  if (sentences.length === 0) return "Empty Meeting"
  const first = sentences[0].replace(/[.!?]+$/, "").trim()
  return first.length > 80 ? first.slice(0, 77) + "..." : first
}

function generateOverview(transcript: Transcript): string {
  const charCount = transcript.fullText.length
  const chunkCount = transcript.chunks.length
  const durationMs =
    chunkCount > 0
      ? transcript.chunks[chunkCount - 1].endTimeMs - transcript.chunks[0].startTimeMs
      : 0
  const durationSec = Math.round(durationMs / 1000)
  return `Transcript: ${charCount} characters, ${chunkCount} chunk(s), ~${durationSec}s duration.`
}

function createKeywordBackend(): SummaryBackend {
  return {
    async analyze(transcript: Transcript): Promise<AnalysisResult> {
      const sentences = splitSentences(transcript.fullText)

      const actionItems = sentences
        .filter((s) => ACTION_PATTERN.test(s))
        .map((s) => ({
          id: uuid(),
          description: s.trim(),
          assignee: null,
          dueDate: null,
        }))

      const decisions = sentences
        .filter((s) => DECISION_PATTERN.test(s))
        .map((s) => ({
          id: uuid(),
          description: s.trim(),
          madeBy: null,
        }))

      const matched = new Set([
        ...sentences.filter((s) => ACTION_PATTERN.test(s)),
        ...sentences.filter((s) => DECISION_PATTERN.test(s)),
        ...sentences.filter((s) => QUESTION_PATTERN.test(s)),
      ])
      const keyPoints = sentences.filter((s) => !matched.has(s))

      return {
        title: generateTitle(sentences),
        overview: generateOverview(transcript),
        actionItems,
        decisions,
        keyPoints,
      }
    },
  }
}

const SUMMARY_PROMPT = `You are a meeting notes assistant. Analyze the following meeting transcript and return a JSON object with exactly this structure:

{
  "title": "A short descriptive title for the meeting (max 10 words)",
  "overview": "A 2-3 sentence summary of what was discussed",
  "keyPoints": ["key point 1", "key point 2", ...],
  "actionItems": [{"description": "what needs to be done", "assignee": "person or null"}],
  "decisions": [{"description": "what was decided"}]
}

If a field has no items, use an empty array. Return ONLY valid JSON, no markdown fences.`

export function createAIBackend(apiKey: string): SummaryBackend {
  return {
    async analyze(transcript: Transcript): Promise<AnalysisResult> {
      const text = transcript.fullText.trim()
      if (!text) {
        return {
          title: "Empty Meeting",
          overview: "No speech was captured during this meeting.",
          actionItems: [],
          decisions: [],
          keyPoints: [],
        }
      }

      const response = await stream({
        provider: "glm",
        model: "glm-4.7-flash",
        apiKey,
        maxTokens: 1024,
        temperature: 0.3,
        messages: [
          { role: "system", content: SUMMARY_PROMPT },
          { role: "user", content: `Transcript:\n\n${text}` },
        ],
      })

      const result = await response
      const content = result.message.content
      const responseText = typeof content === "string"
        ? content
        : content
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("")

      const parsed = JSON.parse(responseText)

      return {
        title: parsed.title ?? "Meeting Summary",
        overview: parsed.overview ?? "",
        actionItems: (parsed.actionItems ?? []).map((a: { description: string; assignee?: string | null }) => ({
          id: uuid(),
          description: a.description,
          assignee: a.assignee ?? null,
          dueDate: null,
        })),
        decisions: (parsed.decisions ?? []).map((d: { description: string }) => ({
          id: uuid(),
          description: d.description,
          madeBy: null,
        })),
        keyPoints: parsed.keyPoints ?? [],
      }
    },
  }
}

export interface LiveSummaryBackend {
  analyzeRecent(chunks: TranscriptChunk[], previous: LiveNote | null): Promise<{
    keyPoints: string[]
    actionItems: ActionItem[]
  }>
}

export function createKeywordLiveBackend(): LiveSummaryBackend {
  return {
    async analyzeRecent(chunks: TranscriptChunk[], previous: LiveNote | null) {
      const text = chunks.map((c) => c.text).join(" ")
      const sentences = splitSentences(text)

      const previousKeyPoints = new Set(previous?.keyPoints ?? [])
      const previousDescriptions = new Set(
        (previous?.actionItems ?? []).map((a) => a.description),
      )

      const actionItems = sentences
        .filter((s) => ACTION_PATTERN.test(s))
        .filter((s) => !previousDescriptions.has(s.trim()))
        .map((s) => ({
          id: uuid(),
          description: s.trim(),
          assignee: null,
          dueDate: null,
        }))

      const matched = new Set([
        ...sentences.filter((s) => ACTION_PATTERN.test(s)),
        ...sentences.filter((s) => DECISION_PATTERN.test(s)),
        ...sentences.filter((s) => QUESTION_PATTERN.test(s)),
      ])
      const keyPoints = sentences
        .filter((s) => !matched.has(s))
        .filter((s) => !previousKeyPoints.has(s.trim()))

      return { keyPoints, actionItems }
    },
  }
}

export function createIntelligenceService(
  backend?: SummaryBackend,
  liveBackend?: LiveSummaryBackend,
): IntelligenceService {
  const b = backend ?? createKeywordBackend()
  const lb = liveBackend ?? undefined

  const service: IntelligenceService = {
    async generateSummary(transcript: Transcript): Promise<MeetingSummary> {
      const result = await b.analyze(transcript)

      return {
        id: uuid(),
        meetingId: transcript.meetingId,
        title: result.title,
        overview: result.overview,
        actionItems: result.actionItems,
        decisions: result.decisions,
        keyPoints: result.keyPoints,
        createdAt: new Date().toISOString(),
      }
    },
  }

  if (lb) {
    service.generateLiveNote = async (
      meetingId: string,
      recentChunks: TranscriptChunk[],
      previousNote: LiveNote | null,
    ): Promise<LiveNote> => {
      const result = await lb.analyzeRecent(recentChunks, previousNote)
      const seqNum = previousNote ? previousNote.sequenceNum + 1 : 0

      return {
        id: uuid(),
        meetingId,
        sequenceNum: seqNum,
        keyPoints: result.keyPoints,
        actionItems: result.actionItems,
        windowStartMs: recentChunks.length > 0 ? recentChunks[0].startTimeMs : 0,
        windowEndMs: recentChunks.length > 0 ? recentChunks[recentChunks.length - 1].endTimeMs : 0,
        createdAt: new Date().toISOString(),
      }
    }
  }

  return service
}

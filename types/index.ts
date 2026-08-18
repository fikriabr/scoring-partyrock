// types/index.ts

import type { CrawlStatus, ScoreStatus, ScoringMode } from '@prisma/client'

// -----------------------------------------------------------------------
// PartyRock Crawler Types
// -----------------------------------------------------------------------

export interface WidgetInfo {
  type: string
  label: string
}

export interface PartyRockMetadata {
  title: string | null
  description: string | null
  widgets: WidgetInfo[]
  prompts: string[]
  widgetCount: number
  sourceCode?: string | null
}

// -----------------------------------------------------------------------
// Scoring Types
// -----------------------------------------------------------------------

export interface ScoringParameter {
  id: string
  name: string
  description: string | null
  weight: number
  minScore: number
  maxScore: number
  scoringMode: ScoringMode
}

export interface ScoringResult {
  score: number
  reasoning: string
  /** True when the raw Gemini value was out of range and was clamped */
  clamped?: boolean
}

// -----------------------------------------------------------------------
// Leaderboard / Report Types
// -----------------------------------------------------------------------

export interface ParameterScore {
  parameterId: string
  parameterName: string
  weight: number
  aiScore: number | null
  aiReasoning: string | null
  juryScore: number | null
  juryComment: string | null
  finalScore: number | null
}

export interface ProjectWithScores {
  id: string
  categoryId: string
  url: string
  participantName: string
  teamName: string | null
  crawlStatus: CrawlStatus
  scoreStatus: ScoreStatus
  finalScore: number | null
  createdAt: Date
  aiScores: Array<{ parameterId: string; score: number; reasoning: string }>
  juryScores: Array<{
    parameterId: string
    juryId: string
    score: number
    comment: string | null
  }>
  parameterScores?: ParameterScore[]
  rank?: number
}

// -----------------------------------------------------------------------
// API Error Type
// -----------------------------------------------------------------------

export interface ApiError {
  error: string
  message: string
  code: string
}

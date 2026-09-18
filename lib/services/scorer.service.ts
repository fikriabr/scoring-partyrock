// lib/services/scorer.service.ts
// AI scoring service using Google Gemini.

import { GoogleGenerativeAI } from '@google/generative-ai'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { calculateWeightedScore } from '@/lib/services/leaderboard.service'
import type {
  ProjectMetadata,
  ScoringParameter,
  ScoringResult,
} from '@/types'

// -----------------------------------------------------------------------
// Gemini client — authenticated via the GEMINI_API_KEY env var. This is a
// free-tier API key (no billing/credit card required), read from
// process.env at module load time.
// -----------------------------------------------------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? '')

// -----------------------------------------------------------------------
// buildPrompt
// Constructs the evaluation prompt for Gemini with all 5 analysis
// methods described in the design document:
//   1. Semantic similarity   → Creativity & Originality
//   2. NLP extraction        → Problem-Solution Fit
//   3. Widget complexity     → Effective Use of PartyRock Features
//   4. Description completeness → User Experience & Presentation
//   5. Keyword/topic analysis   → Impact & Scalability
// -----------------------------------------------------------------------
function buildPrompt(
  metadata: ProjectMetadata,
  parameter: ScoringParameter,
  contextProjects: ProjectMetadata[],
): string {
  const widgetList = metadata.widgets.map((w) => `${w.type} (${w.label})`).join(', ') || 'none'
  const promptList = metadata.prompts.join(' | ') || 'none'
  const sourceCodeSection = metadata.sourceCode
    ? metadata.sourceCode.slice(0, 20000)
    : '(no source code provided)'

  const contextSection =
    contextProjects.length > 0
      ? contextProjects
        .map(
          (p) =>
            `- Title: ${p.title ?? '(no title)'} | Widgets: ${p.widgetCount} | Description: ${p.description ?? '(no description)'}`,
        )
        .join('\n')
      : '(no other projects in this category)'

  return `
You are an AI judge evaluating applications built on AWS PartyRock.

## Application to Evaluate
Title: ${metadata.title ?? '(no title)'}
Description: ${metadata.description ?? '(no description)'}
Widgets used: ${widgetList}
Widget count: ${metadata.widgetCount}
Prompts detected: ${promptList}

## Source Code
${sourceCodeSection}

## Evaluation Parameter
Name: ${parameter.name}
Description: ${parameter.description ?? '(no description)'}
Score range: ${parameter.minScore} to ${parameter.maxScore}

## Other Projects in This Category (for comparison)
${contextSection}

## Analysis Instructions
Apply the analysis method most appropriate for the parameter being evaluated. The application's SOURCE CODE (shown above) is the primary evidence — use the title, description, widgets and prompts as supporting context only.

1. **Code Quality & Structure** (if relevant to the parameter): Assess the source code for clarity, organization, and correct use of PartyRock/AWS widget configuration.

2. **Semantic Similarity** (Creativity & Originality): Compare this application's concept, source code structure, and prompts against the other projects listed above. A more unique or novel implementation should score higher.

3. **NLP Extraction** (Problem-Solution Fit): Extract the problem being solved and the proposed solution from the title, description, and source code. Rate how clearly and directly the application addresses a real user problem.

4. **Widget Complexity & Diversity** (Effective Use of PartyRock Features): Evaluate the number, variety, and sophistication of widgets configured in the source code. Applications that use multiple widget types in creative ways should score higher.

5. **Description Completeness & Clarity** (User Experience & Presentation): Assess whether the title, description, and source code comments clearly communicate the purpose, target audience, and usage of the application.

6. **Keyword & Topic Analysis** (Impact & Scalability): Identify keywords and topics related to real-world impact, scalability, and broad applicability from the description, prompts, and source code. Applications addressing widespread problems score higher.

## Output Format
Respond with a valid JSON object only — no markdown, no code blocks, no additional text:
{"score": <number between ${parameter.minScore} and ${parameter.maxScore}>, "reasoning": "<concise explanation of the score, 2–4 sentences>"}
`.trim()
}

// -----------------------------------------------------------------------
// parseGeminiResponse
// Extracts score and reasoning from a Google Gemini API response.
// `rawText` is the raw text returned by `result.response.text()` and is
// expected to be a JSON object { score, reasoning } (optionally wrapped
// in markdown code fences).
//
// Clamping: if the model returns a score outside [minScore, maxScore],
// it is clamped to the nearest boundary and a warning is appended to
// the reasoning. ScoringResult.clamped is set to true.
// -----------------------------------------------------------------------
function parseGeminiResponse(
  rawText: string,
  parameter: ScoringParameter,
): ScoringResult {
  const textContent: string = rawText ?? ''

  if (!textContent) {
    throw new Error('Empty response body from Gemini')
  }

  // Strip potential markdown code fences that the model may include
  const cleaned = textContent
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  let parsed: { score: unknown; reasoning: unknown }
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Gemini response is not valid JSON: ${cleaned.slice(0, 200)}`)
  }

  const rawScore = Number(parsed.score)
  const reasoning = String(parsed.reasoning ?? '')

  if (!Number.isFinite(rawScore)) {
    throw new Error(
      `Gemini returned non-numeric score: ${String(parsed.score)}`,
    )
  }

  const { minScore, maxScore } = parameter

  // Clamp score to configured parameter range
  let score = rawScore
  let clamped = false
  let clampedReasoning = reasoning

  if (rawScore < minScore) {
    score = minScore
    clamped = true
    clampedReasoning = `${reasoning} [WARNING: score ${rawScore} was out of range, clamped to ${minScore}]`
  } else if (rawScore > maxScore) {
    score = maxScore
    clamped = true
    clampedReasoning = `${reasoning} [WARNING: score ${rawScore} was out of range, clamped to ${maxScore}]`
  }

  return {
    score,
    reasoning: clampedReasoning,
    ...(clamped && { clamped: true }),
  }
}

// -----------------------------------------------------------------------
// ScorerService
// Main service class for AI-based parameter scoring via Google Gemini.
// -----------------------------------------------------------------------
export class ScorerService {
  /**
   * Trigger AI scoring for all AUTO parameters of a project.
   *
   * Fetches the project with its category parameters and CrawlMetadata,
   * fetches other projects' metadata in the same category as context,
   * then scores each AUTO parameter via Google Gemini.
   *
   * Score status transitions:
   *   - All parameters succeeded → scoreStatus = 'SUCCESS'
   *   - Some failed              → scoreStatus = 'PARTIAL'
   *   - All failed               → scoreStatus = 'FAILED'
   *
   * Also calculates and saves a provisional finalScore from successful
   * AI scores using calculateWeightedScore.
   */
  static async triggerScoring(projectId: string): Promise<void> {
    // 1. Fetch project with category parameters and crawl metadata. Throws
    // if the project was soft-deleted since this was queued — a deleted
    // project should never get a fresh score written to it.
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId, deletedAt: null },
      include: {
        category: { include: { parameters: true } },
        metadata: true,
      },
    })

    // 2. Filter to AUTO-mode parameters only
    const autoParameters = project.category.parameters.filter(
      (p) => p.scoringMode === 'AUTO',
    )

    console.log(`[Scorer] Starting AI scoring for project ${projectId} — ${autoParameters.length} AUTO parameter(s)`)

    // Mark scoring as actively running so pollers (e.g. the admin submissions
    // UI) can distinguish "queued, not started" (PENDING) from "Gemini calls
    // are in flight right now" (PROCESSING).
    await db.project.update({
      where: { id: projectId },
      data: { scoreStatus: 'PROCESSING' },
    })

    if (autoParameters.length === 0) {
      // Nothing to score — mark as SUCCESS with no AI scores.
      await db.project.update({
        where: { id: projectId },
        data: { scoreStatus: 'SUCCESS' },
      })
      return
    }

    // Build this project's metadata for the scorer. Title/description/widgets
    // come from the (optional) crawl metadata; sourceCode is the
    // participant-pasted code, which is the primary scoring input.
    const metadata: ProjectMetadata = project.metadata
      ? {
        title: project.metadata.title,
        description: project.metadata.description,
        widgets: project.metadata.widgets as unknown as ProjectMetadata['widgets'],
        prompts: project.metadata.prompts as unknown as string[],
        widgetCount: project.metadata.widgetCount,
        sourceCode: project.sourceCode,
      }
      : {
        title: null,
        description: null,
        widgets: [],
        prompts: [],
        widgetCount: 0,
        sourceCode: project.sourceCode,
      }

    // 3. Fetch other projects' metadata in the same category as context
    const siblingMetadataRows = await db.crawlMetadata.findMany({
      where: {
        project: {
          categoryId: project.categoryId,
          id: { not: projectId },
        },
      },
    })

    const contextProjects: ProjectMetadata[] = siblingMetadataRows.map((m) => ({
      title: m.title,
      description: m.description,
      widgets: m.widgets as unknown as ProjectMetadata['widgets'],
      prompts: m.prompts as unknown as string[],
      widgetCount: m.widgetCount,
    }))

    // 4. Score each AUTO parameter, collecting results and errors
    type ParameterOutcome =
      | { success: true; parameterId: string; result: ScoringResult; weight: number }
      | { success: false; parameterId: string; error: unknown }

    const outcomes: ParameterOutcome[] = await Promise.all(
      autoParameters.map(async (param) => {
        const scoringParam: ScoringParameter = {
          id: param.id,
          name: param.name,
          description: param.description,
          weight: param.weight,
          minScore: param.minScore,
          maxScore: param.maxScore,
          scoringMode: param.scoringMode,
        }
        try {
          const result = await ScorerService.scoreParameter(
            metadata,
            scoringParam,
            contextProjects,
          )
          console.log(`[Scorer] Parameter "${param.name}" scored: ${result.score}`)
          return { success: true as const, parameterId: param.id, result, weight: param.weight }
        } catch (error) {
          console.error(`[ScorerService] Failed to score parameter ${param.id} for project ${projectId}:`, error)
          return { success: false as const, parameterId: param.id, error }
        }
      }),
    )

    // 5. Upsert each successful AIScore to DB
    const successful = outcomes.filter((o) => o.success === true) as Extract<ParameterOutcome, { success: true }>[]
    const failed = outcomes.filter((o) => o.success === false)

    await Promise.all(
      successful.map((o) =>
        db.aIScore.upsert({
          where: {
            projectId_parameterId: {
              projectId,
              parameterId: o.parameterId,
            },
          },
          create: {
            projectId,
            parameterId: o.parameterId,
            score: o.result.score,
            reasoning: o.result.reasoning,
          },
          update: {
            score: o.result.score,
            reasoning: o.result.reasoning,
            scoredAt: new Date(),
          },
        }),
      ),
    )

    // 6. Determine final score status
    let scoreStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED'
    if (failed.length === 0) {
      scoreStatus = 'SUCCESS'
    } else if (successful.length === 0) {
      scoreStatus = 'FAILED'
    } else {
      scoreStatus = 'PARTIAL'
    }

    // 7. Calculate provisional finalScore from successful scores
    const weightedInputs = successful.map((o) => ({
      score: o.result.score,
      weight: o.weight,
    }))
    const finalScore = successful.length > 0
      ? calculateWeightedScore(weightedInputs)
      : null

    // 8. Update project with new status and provisional finalScore
    await db.project.update({
      where: { id: projectId },
      data: { scoreStatus, finalScore },
    })

    // 9. Revalidate leaderboard pages so updated scores are visible
    revalidatePath(`/admin/leaderboard/${project.categoryId}`)
    revalidatePath(`/public/leaderboard`)

    console.log(`[Scorer] Scoring complete for project ${projectId} — status: ${scoreStatus}, finalScore: ${finalScore}`)
  }

  /**
   * Score a single parameter for a project using Google Gemini.
   *
   * @param metadata       - Crawled metadata for the project being scored.
   * @param parameter      - The scoring parameter (name, weight, range, mode).
   * @param contextProjects - Other projects in the same category for comparison.
   * @returns ScoringResult with score (clamped to range), reasoning, and
   *          optional `clamped` flag if the raw model value was out of range.
   */
  static async scoreParameter(
    metadata: ProjectMetadata,
    parameter: ScoringParameter,
    contextProjects: ProjectMetadata[],
  ): Promise<ScoringResult> {
    const prompt = buildPrompt(metadata, parameter, contextProjects)

    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL_ID ?? 'gemini-flash-lite-latest',
    })

    const result = await model.generateContent(prompt)
    const text = result.response.text()

    return parseGeminiResponse(text, parameter)
  }
}

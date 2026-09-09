/**
 * Integration Tests: Submission → Crawl → Score Pipeline
 *
 * **Validates: Requirements 4.1, 4.4, 5.1, 5.8** (spec `partyrock-assessment-tool`)
 *
 * 1. Happy path: submit → crawl succeeds → AI score succeeds
 * 2. Crawl timeout failure: crawlStatus = FAILED, scoring NOT triggered
 * 3. Scoring partial failure: scoreStatus = PARTIAL, finalScore from successful params
 * 4. Regression: the prompt reaching Gemini is the PartyRock template
 *
 * All external dependencies (the crawler's HTTP fetch, Google Gemini, Prisma
 * DB, next/cache) are mocked to isolate pipeline logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock modules BEFORE importing services
// ---------------------------------------------------------------------------

// Mock next/cache (revalidatePath is called after scoring)
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Mock Prisma DB client
vi.mock('@/lib/db', () => ({
  db: {
    project: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    crawlMetadata: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    aIScore: {
      upsert: vi.fn(),
    },
  },
}))

// Mock global fetch — the crawler reads PartyRock's static SEO meta tags over
// plain HTTP (no browser). See lib/services/crawler.service.ts for why.
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

/** Build an HTML document exposing the SEO meta tags the crawler reads. */
function createPartyRockHtml(title: string, description: string): string {
  return `<!doctype html><html><head>
    <title>${title}</title>
    <meta property="og:title" content="${title}">
    <meta name="description" content="${description}">
  </head><body></body></html>`
}

/** Make the next fetch() call resolve with the given HTML body. */
function mockFetchHtmlOnce(html: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: async () => html,
  })
}

// Mock Google Gemini
const { mockGenerateContent } = vi.hoisted(() => {
  return { mockGenerateContent: vi.fn() }
})
vi.mock('@google/generative-ai', () => {
  class MockGoogleGenerativeAI {
    constructor(_apiKey: string) { }
    getGenerativeModel(_config: unknown) {
      return { generateContent: mockGenerateContent }
    }
  }
  return { GoogleGenerativeAI: MockGoogleGenerativeAI }
})

// ---------------------------------------------------------------------------
// Import services and mocked dependencies
// ---------------------------------------------------------------------------

import { db } from '@/lib/db'
import { submitProject } from '@/lib/services/submission.service'
import { CrawlerService } from '@/lib/services/crawler.service'
import { ScorerService } from '@/lib/services/scorer.service'

// Access mock internals
const mockProjectCreate = vi.mocked(db.project.create)
const mockProjectFindFirst = vi.mocked(db.project.findFirst)
const mockProjectFindUniqueOrThrow = vi.mocked(db.project.findUniqueOrThrow)
const mockProjectUpdate = vi.mocked(db.project.update)
const mockCrawlMetadataUpsert = vi.mocked(db.crawlMetadata.upsert)
const mockCrawlMetadataFindMany = vi.mocked(db.crawlMetadata.findMany)
const mockAIScoreUpsert = vi.mocked(db.aIScore.upsert)

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Every prompt string handed to Gemini, in call order. */
function promptsSentToGemini(): string[] {
  return mockGenerateContent.mock.calls.map((call) => String(call[0]))
}

/**
 * The `data` payload of the `project.update` call that carried the given
 * status value. `triggerCrawl` and `triggerScoring` both update the same row
 * several times, so picking the call out by the status it wrote is more
 * readable than indexing into `mock.calls`.
 */
function findProjectUpdateData(
  field: 'crawlStatus' | 'scoreStatus',
  value: string,
): Record<string, unknown> | null {
  for (const call of mockProjectUpdate.mock.calls) {
    const data = (call[0] as { data?: Record<string, unknown> }).data
    if (data && data[field] === value) return data
  }
  return null
}

// ---------------------------------------------------------------------------
// Test Data Factories
// ---------------------------------------------------------------------------

/** A Project row. */
function createFakeProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 'project-1',
    categoryId: 'category-1',
    url: 'https://partyrock.aws/app/test-app',
    participantName: 'Test User',
    teamName: null,
    sourceCode: null as string | null,
    crawlStatus: 'PENDING' as const,
    crawlError: null,
    scoreStatus: 'PENDING' as const,
    finalScore: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

/**
 * A Project row with its category parameters and CrawlMetadata, shaped the way
 * `ScorerService.triggerScoring` reads it.
 */
function createFakeProjectWithCategory(
  overrides: Record<string, unknown> = {},
  metadataOverrides: Record<string, unknown> = {},
) {
  return {
    ...createFakeProject(),
    category: {
      id: 'category-1',
      eventId: 'event-1',
      name: 'Test Category',
      description: null,
      isPublished: false,
      publicToken: null,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      parameters: [
        {
          id: 'param-1',
          categoryId: 'category-1',
          name: 'Creativity & Originality',
          description: 'Semantic similarity analysis',
          weight: 30,
          minScore: 0,
          maxScore: 100,
          scoringMode: 'AUTO' as const,
          orderIndex: 0,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'param-2',
          categoryId: 'category-1',
          name: 'Problem-Solution Fit',
          description: 'NLP extraction analysis',
          weight: 40,
          minScore: 0,
          maxScore: 100,
          scoringMode: 'AUTO' as const,
          orderIndex: 1,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
        {
          id: 'param-3',
          categoryId: 'category-1',
          name: 'User Experience',
          description: 'Description completeness',
          weight: 30,
          minScore: 0,
          maxScore: 100,
          scoringMode: 'AUTO' as const,
          orderIndex: 2,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        },
      ],
    },
    metadata: {
      id: 'metadata-1',
      projectId: 'project-1',
      title: 'My PartyRock App',
      description: 'A creative AI application',
      widgets: [
        { type: 'text-input', label: 'Topic' },
        { type: 'ai', label: 'Generator' },
      ],
      prompts: ['Generate a story about {{topic}}'],
      widgetCount: 2,
      rawHtml: null,
      crawledAt: new Date('2024-01-01'),
      ...metadataOverrides,
    },
    ...overrides,
  }
}

function createGeminiResponse(score: number, reasoning: string) {
  return { response: { text: () => JSON.stringify({ score, reasoning }) } }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Test 1: Happy Path — submitProject → triggerCrawl → triggerScoring
// ---------------------------------------------------------------------------

describe('Pipeline Integration: Happy Path', () => {
  it('should complete full pipeline: submit → crawl → score with correct status transitions', async () => {
    // --- Phase 1: Submit Project ---
    mockProjectFindFirst.mockResolvedValueOnce(null) // no duplicate
    const createdProject = createFakeProject()
    mockProjectCreate.mockResolvedValueOnce(createdProject as never)

    const result = await submitProject({
      url: 'https://partyrock.aws/app/test-app',
      participantName: 'Test User',
      categoryId: 'clxxxxxxxxxxxxxxxxxx001',
    })

    expect(result.crawlStatus).toBe('PENDING')
    expect(result.scoreStatus).toBe('PENDING')
    expect(mockProjectCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          url: 'https://partyrock.aws/app/test-app',
          crawlStatus: 'PENDING',
          scoreStatus: 'PENDING',
        }),
      }),
    )

    // --- Phase 2: Trigger Crawl ---
    // Setup mocks for triggerCrawl
    mockProjectFindUniqueOrThrow.mockResolvedValueOnce(
      createFakeProject({ category: { id: 'category-1' } }) as never,
    )
    // First update: PROCESSING
    mockProjectUpdate.mockResolvedValue(createFakeProject({ crawlStatus: 'PROCESSING' }) as never)
    mockCrawlMetadataUpsert.mockResolvedValueOnce({} as never)

    // Mock the crawler's HTTP fetch of the PartyRock page
    mockFetchHtmlOnce(
      createPartyRockHtml('My PartyRock App', 'A creative AI application'),
    )

    // For the ScorerService.triggerScoring call after crawl succeeds
    const projectWithCategory = createFakeProjectWithCategory()
    mockProjectFindUniqueOrThrow.mockResolvedValueOnce(projectWithCategory as never)
    mockCrawlMetadataFindMany.mockResolvedValueOnce([])
    mockAIScoreUpsert.mockResolvedValue({} as never)

    // Mock Gemini responses for 3 parameters
    mockGenerateContent
      .mockResolvedValueOnce(createGeminiResponse(85, 'Very creative'))
      .mockResolvedValueOnce(createGeminiResponse(78, 'Good problem-solution fit'))
      .mockResolvedValueOnce(createGeminiResponse(90, 'Excellent UX'))

    // Final project update with score status and finalScore
    mockProjectUpdate.mockResolvedValue(
      createFakeProject({ scoreStatus: 'SUCCESS', finalScore: 83.7 }) as never,
    )

    await CrawlerService.triggerCrawl('project-1')

    // Wait for async scoring trigger (fire-and-forget in the service)
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Assert: crawlStatus transitions
    // First call: set to PROCESSING
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'project-1' },
        data: expect.objectContaining({ crawlStatus: 'PROCESSING' }),
      }),
    )

    // Second call: set to SUCCESS
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'project-1' },
        data: expect.objectContaining({ crawlStatus: 'SUCCESS' }),
      }),
    )

    // Assert: CrawlMetadata was upserted. widgetCount is 0 because the HTTP
    // crawler only reads static SEO meta tags — widget data comes from the
    // manual capture pipeline (see lib/services/capture.service.ts).
    expect(mockCrawlMetadataUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project-1' },
        create: expect.objectContaining({
          projectId: 'project-1',
          title: 'My PartyRock App',
          description: 'A creative AI application',
          widgetCount: 0,
        }),
      }),
    )

    // Assert: AI scores were upserted for all 3 parameters
    expect(mockAIScoreUpsert).toHaveBeenCalledTimes(3)

    // Assert: Final project update includes scoreStatus SUCCESS
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'project-1' },
        data: expect.objectContaining({ scoreStatus: 'SUCCESS' }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Test 2: Crawl Timeout Failure
// ---------------------------------------------------------------------------

describe('Pipeline Integration: Crawl Timeout Failure', () => {
  it('should set crawlStatus = FAILED when the fetch times out, and NOT trigger scoring', async () => {
    // Setup: findUniqueOrThrow returns the project
    mockProjectFindUniqueOrThrow.mockResolvedValueOnce(
      createFakeProject({ category: { id: 'category-1' } }) as never,
    )
    mockProjectUpdate.mockResolvedValue(createFakeProject({ crawlStatus: 'FAILED' }) as never)

    // Mock the crawler's HTTP fetch to abort with a timeout
    mockFetch.mockRejectedValueOnce(
      new Error('Timeout: the operation was aborted after 15000ms'),
    )

    // Spy on ScorerService.triggerScoring to verify it is NOT called
    const scoringSpy = vi.spyOn(ScorerService, 'triggerScoring')

    await CrawlerService.triggerCrawl('project-1')

    // Assert: crawlStatus was set to PROCESSING first
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'project-1' },
        data: expect.objectContaining({ crawlStatus: 'PROCESSING' }),
      }),
    )

    // Assert: crawlStatus was set to FAILED with error message
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'project-1' },
        data: expect.objectContaining({
          crawlStatus: 'FAILED',
          crawlError: expect.stringContaining('Timeout'),
        }),
      }),
    )

    // Assert: scoring was NOT triggered (fire-and-forget is never called when crawl fails)
    // After the crawl fails, we should NOT see triggerScoring called by the crawl pipeline
    // The update calls should only be PROCESSING and FAILED — no SUCCESS
    const updateCalls = mockProjectUpdate.mock.calls.map(
      (call) => (call[0] as { data: { crawlStatus?: string } }).data.crawlStatus,
    )
    expect(updateCalls).toContain('PROCESSING')
    expect(updateCalls).toContain('FAILED')
    expect(updateCalls).not.toContain('SUCCESS')

    scoringSpy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Test 3: Scoring Partial Failure
// ---------------------------------------------------------------------------

describe('Pipeline Integration: Scoring Partial Failure', () => {
  it('should set scoreStatus = PARTIAL and calculate finalScore from successful params only', async () => {
    // Setup project with category and 3 AUTO parameters
    const projectWithCategory = createFakeProjectWithCategory()
    mockProjectFindUniqueOrThrow.mockResolvedValueOnce(projectWithCategory as never)
    mockCrawlMetadataFindMany.mockResolvedValueOnce([])
    mockAIScoreUpsert.mockResolvedValue({} as never)
    mockProjectUpdate.mockResolvedValue({} as never)

    // Mock Gemini: 2 successes, 1 failure (param-3 throws)
    mockGenerateContent
      .mockResolvedValueOnce(createGeminiResponse(80, 'Good creativity'))  // param-1: score 80, weight 30
      .mockResolvedValueOnce(createGeminiResponse(70, 'Decent fit'))       // param-2: score 70, weight 40
      .mockRejectedValueOnce(new Error('Gemini InternalServerError'))       // param-3: FAILS

    await ScorerService.triggerScoring('project-1')

    // Assert: Only 2 AI scores were upserted (param-3 failed)
    expect(mockAIScoreUpsert).toHaveBeenCalledTimes(2)

    // Assert: scoreStatus set to PARTIAL
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'project-1' },
        data: expect.objectContaining({
          scoreStatus: 'PARTIAL',
        }),
      }),
    )

    // Assert: finalScore is calculated from successful params only
    // Expected: (80 * 30 + 70 * 40) / 100 = (2400 + 2800) / 100 = 52
    const finalUpdateCall = mockProjectUpdate.mock.calls.find(
      (call) => (call[0] as { data: { scoreStatus?: string } }).data.scoreStatus === 'PARTIAL',
    )
    expect(finalUpdateCall).toBeDefined()
    const updateData = (finalUpdateCall![0] as { data: { finalScore?: number } }).data
    expect(updateData.finalScore).toBeCloseTo(52, 1)
  })

  it('should set scoreStatus = FAILED when all Gemini calls fail', async () => {
    const projectWithCategory = createFakeProjectWithCategory()
    mockProjectFindUniqueOrThrow.mockResolvedValueOnce(projectWithCategory as never)
    mockCrawlMetadataFindMany.mockResolvedValueOnce([])
    mockProjectUpdate.mockResolvedValue({} as never)

    // Mock Gemini: ALL fail
    mockGenerateContent
      .mockRejectedValueOnce(new Error('Gemini timeout'))
      .mockRejectedValueOnce(new Error('Gemini throttle'))
      .mockRejectedValueOnce(new Error('Gemini internal error'))

    await ScorerService.triggerScoring('project-1')

    // Assert: No AI scores upserted
    expect(mockAIScoreUpsert).not.toHaveBeenCalled()

    // Assert: scoreStatus set to FAILED
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'project-1' },
        data: expect.objectContaining({
          scoreStatus: 'FAILED',
        }),
      }),
    )

    // Assert: finalScore is null when all fail
    const failedCall = mockProjectUpdate.mock.calls.find(
      (call) => (call[0] as { data: { scoreStatus?: string } }).data.scoreStatus === 'FAILED',
    )
    expect(failedCall).toBeDefined()
    const updateData = (failedCall![0] as { data: { finalScore?: number | null } }).data
    expect(updateData.finalScore).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Test 4: PartyRock prompt regression
// ---------------------------------------------------------------------------

describe('Pipeline Integration: PartyRock Prompt Regression', () => {
  it('sends the PartyRock prompt with widget/prompt evidence', async () => {
    const projectWithCategory = createFakeProjectWithCategory()
    mockProjectFindUniqueOrThrow.mockResolvedValueOnce(projectWithCategory as never)
    mockCrawlMetadataFindMany.mockResolvedValueOnce([])
    mockAIScoreUpsert.mockResolvedValue({} as never)
    mockProjectUpdate.mockResolvedValue({} as never)

    mockGenerateContent
      .mockResolvedValueOnce(createGeminiResponse(85, 'Very creative'))
      .mockResolvedValueOnce(createGeminiResponse(78, 'Good problem-solution fit'))
      .mockResolvedValueOnce(createGeminiResponse(90, 'Excellent UX'))

    await ScorerService.triggerScoring('project-1')

    const prompts = promptsSentToGemini()
    expect(prompts).toHaveLength(3)
    for (const prompt of prompts) {
      expect(prompt).toContain(
        'You are an AI judge evaluating applications built on AWS PartyRock',
      )
      expect(prompt).toContain('Widget count: 2')
      expect(prompt).toContain('text-input (Topic)')
    }

    expect(mockAIScoreUpsert).toHaveBeenCalledTimes(3)
    const finalUpdate = findProjectUpdateData('scoreStatus', 'SUCCESS')
    expect(finalUpdate).not.toBeNull()
    // (85×30 + 78×40 + 90×30) / 100
    expect(finalUpdate?.finalScore as number).toBeCloseTo(83.7, 1)
  })
})

/**
 * Unit Tests: POST /api/submissions — pipeline entry point
 *
 * The route creates the Project and then kicks off scoring directly via
 * `ScorerService.triggerScoring`. Widgets and prompts come from the Capture
 * Pipeline rather than a crawl, so scoring starts immediately on whatever
 * evidence was pasted at submission time.
 *
 * Everything below the route is mocked — the route's only job is dispatch, so
 * the assertions are about which entry point was called, not about what it
 * does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mock modules BEFORE importing the route under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(),
}))

// `DuplicateUrlError` is re-thrown by the route through an `instanceof` check,
// so the mock has to expose a real class rather than a stub.
vi.mock('@/lib/services/submission.service', () => {
  class DuplicateUrlError extends Error {
    constructor(url: string, categoryId: string) {
      super('Project with URL ' + url + ' already exists in category ' + categoryId)
      this.name = 'DuplicateUrlError'
      Object.setPrototypeOf(this, DuplicateUrlError.prototype)
    }
  }
  return { submitProject: vi.fn(), DuplicateUrlError }
})

vi.mock('@/lib/services/scorer.service', () => ({
  ScorerService: { triggerScoring: vi.fn().mockResolvedValue(undefined) },
}))

import { POST } from '@/app/api/submissions/route'
import { auth } from '@/lib/auth/config'
import { submitProject, DuplicateUrlError } from '@/lib/services/submission.service'
import { ScorerService } from '@/lib/services/scorer.service'

const mockAuth = vi.mocked(auth)
const mockSubmitProject = vi.mocked(submitProject)
const mockTriggerScoring = vi.mocked(ScorerService.triggerScoring)

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

/**
 * The route only ever calls `request.json()`, so a minimal stand-in keeps the
 * test free of `NextRequest` construction details.
 */
function buildRequest(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

/**
 * The rate limiter is real and keys on the user id (10 requests per minute),
 * so every test signs in as a different user and stays clear of it.
 */
let userCounter = 0
function signInAsAdmin() {
  userCounter += 1
  mockAuth.mockResolvedValue({
    user: { id: 'user-' + userCounter, role: 'ADMIN' },
  } as never)
}

function buildProjectRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'project-1',
    categoryId: 'category-1',
    url: 'https://partyrock.aws/app/abc123',
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

const PARTYROCK_BODY = {
  url: 'https://partyrock.aws/app/abc123',
  participantName: 'Test User',
  categoryId: 'clabcdef0001',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTriggerScoring.mockResolvedValue(undefined)
  signInAsAdmin()
})

// ---------------------------------------------------------------------------
// Direct scoring path
// ---------------------------------------------------------------------------

describe('POST /api/submissions — projects score directly', () => {
  it('triggers scoring for the created project', async () => {
    mockSubmitProject.mockResolvedValueOnce(buildProjectRecord() as never)

    const response = await POST(buildRequest(PARTYROCK_BODY))

    expect(response.status).toBe(201)
    expect(mockTriggerScoring).toHaveBeenCalledExactlyOnceWith('project-1')
  })

  it('returns 201 with the created project even when scoring rejects', async () => {
    // Fire-and-forget: a rejected scoring run is logged, never surfaced to the
    // caller, and never left as an unhandled rejection.
    mockSubmitProject.mockResolvedValueOnce(buildProjectRecord() as never)
    mockTriggerScoring.mockRejectedValueOnce(new Error('scoring blew up'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => { })

    const response = await POST(buildRequest(PARTYROCK_BODY))
    const json = await response.json()

    expect(response.status).toBe(201)
    expect(json.id).toBe('project-1')

    consoleError.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// Nothing is triggered when the submission never happens
// ---------------------------------------------------------------------------

describe('POST /api/submissions — no pipeline entry point without a project', () => {
  it('returns 401 and triggers nothing for an unauthenticated caller', async () => {
    mockAuth.mockResolvedValueOnce(null as never)

    const response = await POST(buildRequest(PARTYROCK_BODY))

    expect(response.status).toBe(401)
    expect(mockSubmitProject).not.toHaveBeenCalled()
    expect(mockTriggerScoring).not.toHaveBeenCalled()
  })

  it('returns 409 and triggers nothing on a duplicate URL', async () => {
    mockSubmitProject.mockRejectedValueOnce(
      new DuplicateUrlError('https://partyrock.aws/app/abc123', 'clabcdef0001'),
    )

    const response = await POST(buildRequest(PARTYROCK_BODY))
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.code).toBe('DUPLICATE_URL')
    expect(mockTriggerScoring).not.toHaveBeenCalled()
  })
})

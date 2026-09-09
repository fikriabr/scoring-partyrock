/**
 * Unit Tests: POST /api/submissions/bulk — bulk CSV import
 *
 * Requirement 8.2 — imported rows trigger nothing at all. The admin starts
 * scoring for them through the Capture Pipeline or Retry, because a
 * bulk-imported project has no widgets/prompts captured yet.
 *
 * Everything below the route is mocked; the route's only job here is dispatch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// ---------------------------------------------------------------------------
// Mock modules BEFORE importing the route under test
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(),
}))

vi.mock('@/lib/services/submission.service', () => ({
  bulkImportFromCsv: vi.fn(),
}))

import { POST } from '@/app/api/submissions/bulk/route'
import { auth } from '@/lib/auth/config'
import { bulkImportFromCsv } from '@/lib/services/submission.service'

const mockAuth = vi.mocked(auth)
const mockBulkImport = vi.mocked(bulkImportFromCsv)

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const CATEGORY_ID = 'clabcdef0001'

/**
 * The route reads `file` and `categoryId` off the form data and calls
 * `file.text()`, so a real FormData with a real File keeps the stand-in honest
 * without constructing a full `NextRequest`.
 */
function buildRequest(
  csv = 'url,participant_name\nhttps://partyrock.aws/app/a,Alice',
  categoryId: string | null = CATEGORY_ID,
): NextRequest {
  const formData = new FormData()
  formData.set('file', new File([csv], 'submissions.csv', { type: 'text/csv' }))
  if (categoryId !== null) formData.set('categoryId', categoryId)
  return { formData: async () => formData } as unknown as NextRequest
}

function importResult(
  created: { id: string }[],
  errors: { row: number; message: string }[] = [],
) {
  return { imported: created.length, created, errors }
}

/**
 * The rate limiter is real and keys on the user id (10 requests per minute),
 * so every test signs in as a different admin and stays clear of it.
 */
let userCounter = 0
function signInAsAdmin() {
  userCounter += 1
  mockAuth.mockResolvedValue({
    user: { id: 'admin-' + userCounter, role: 'ADMIN' },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  signInAsAdmin()
})

// ---------------------------------------------------------------------------
// Imported rows trigger nothing (Requirement 8.2)
// ---------------------------------------------------------------------------

describe('POST /api/submissions/bulk', () => {
  it('returns the import summary, including the created ids', async () => {
    mockBulkImport.mockResolvedValueOnce(
      importResult([{ id: 'project-1' }, { id: 'project-2' }]) as never,
    )

    const response = await POST(buildRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.imported).toBe(2)
    expect(json.created).toEqual([{ id: 'project-1' }, { id: 'project-2' }])
    expect(json.errors).toEqual([])
  })

  it('triggers nothing when every row failed validation', async () => {
    mockBulkImport.mockResolvedValueOnce(
      importResult([], [
        { row: 2, message: 'url: Invalid URL' },
        { row: 3, message: 'participantName: Required' },
      ]) as never,
    )

    const response = await POST(buildRequest())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.imported).toBe(0)
    expect(json.errors).toHaveLength(2)
  })

  it('returns 403 for a non-admin caller', async () => {
    mockAuth.mockResolvedValueOnce({
      user: { id: 'juror-1', role: 'JUROR' },
    } as never)

    const response = await POST(buildRequest())

    expect(response.status).toBe(403)
    expect(mockBulkImport).not.toHaveBeenCalled()
  })

  it('returns 401 for an unauthenticated caller', async () => {
    mockAuth.mockResolvedValueOnce(null as never)

    const response = await POST(buildRequest())

    expect(response.status).toBe(401)
    expect(mockBulkImport).not.toHaveBeenCalled()
  })

  it('returns 400 when the CSV body is blank', async () => {
    const response = await POST(buildRequest('   \n  '))

    expect(response.status).toBe(400)
    expect(mockBulkImport).not.toHaveBeenCalled()
  })
})

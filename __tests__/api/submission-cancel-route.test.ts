/**
 * Unit Tests: POST /api/submissions/[id]/cancel — force-fail a stuck
 * crawl/score pipeline
 *
 * The route's job is authorization and existence checking; the actual
 * "only touch what's stuck" logic is pinned separately in
 * __tests__/services/submission-lifecycle.test.ts. So `cancelProcessing`
 * is mocked here and only its call (or lack of one) is asserted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    project: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('@/lib/services/submission.service', () => ({
  cancelProcessing: vi.fn(),
}))

import { POST } from '@/app/api/submissions/[id]/cancel/route'
import { auth } from '@/lib/auth/config'
import { db } from '@/lib/db'
import { cancelProcessing } from '@/lib/services/submission.service'

const mockAuth = vi.mocked(auth)
const mockProjectFindUnique = vi.mocked(db.project.findUnique)
const mockCancelProcessing = vi.mocked(cancelProcessing)

const PROJECT_ID = 'project-1'

function buildContext(id: string = PROJECT_ID) {
  return { params: Promise.resolve({ id }) }
}

let userCounter = 0
function signIn(role: 'ADMIN' | 'JURY') {
  userCounter += 1
  mockAuth.mockResolvedValue({
    user: { id: 'user-' + userCounter, role },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockProjectFindUnique.mockResolvedValue({ id: PROJECT_ID } as never)
  mockCancelProcessing.mockResolvedValue({
    id: PROJECT_ID,
    crawlStatus: 'FAILED',
    scoreStatus: 'FAILED',
  } as never)
  signIn('ADMIN')
})

describe('POST /api/submissions/[id]/cancel', () => {
  it('cancels the stuck pipeline and returns the updated statuses', async () => {
    const response = await POST({} as NextRequest, buildContext())
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(mockCancelProcessing).toHaveBeenCalledExactlyOnceWith(PROJECT_ID)
    expect(json).toEqual({ id: PROJECT_ID, crawlStatus: 'FAILED', scoreStatus: 'FAILED' })
  })

  it('returns 403 for a non-admin caller and cancels nothing', async () => {
    signIn('JURY')

    const response = await POST({} as NextRequest, buildContext())
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.code).toBe('FORBIDDEN')
    expect(mockCancelProcessing).not.toHaveBeenCalled()
  })

  it('returns 403 for an unauthenticated caller and cancels nothing', async () => {
    mockAuth.mockResolvedValueOnce(null as never)

    const response = await POST({} as NextRequest, buildContext())

    expect(response.status).toBe(403)
    expect(mockCancelProcessing).not.toHaveBeenCalled()
  })

  it('returns 404 NOT_FOUND for an unknown project and cancels nothing', async () => {
    mockProjectFindUnique.mockResolvedValueOnce(null as never)

    const response = await POST({} as NextRequest, buildContext('does-not-exist'))
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.code).toBe('NOT_FOUND')
    expect(mockCancelProcessing).not.toHaveBeenCalled()
  })
})

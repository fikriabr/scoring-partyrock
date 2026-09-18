/**
 * Unit Tests: DELETE /api/submissions/[id] — permanently remove a project
 *
 * The route's job is authorization and existence checking; the actual
 * cascade-delete logic is pinned separately in
 * __tests__/services/submission-lifecycle.test.ts. So `deleteProject` is
 * mocked here and only its call (or lack of one) is asserted.
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
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/services/submission.service', () => ({
  deleteProject: vi.fn(),
}))

vi.mock('@/lib/services/scorer.service', () => ({
  ScorerService: { triggerScoring: vi.fn().mockResolvedValue(undefined) },
}))

import { DELETE } from '@/app/api/submissions/[id]/route'
import { auth } from '@/lib/auth/config'
import { db } from '@/lib/db'
import { deleteProject } from '@/lib/services/submission.service'

const mockAuth = vi.mocked(auth)
const mockProjectFindUnique = vi.mocked(db.project.findUnique)
const mockDeleteProject = vi.mocked(deleteProject)

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
  mockDeleteProject.mockResolvedValue(undefined)
  signIn('ADMIN')
})

describe('DELETE /api/submissions/[id]', () => {
  it('deletes the project and returns 204', async () => {
    const response = await DELETE({} as NextRequest, buildContext())

    expect(response.status).toBe(204)
    expect(mockDeleteProject).toHaveBeenCalledExactlyOnceWith(PROJECT_ID)
  })

  it('returns 403 for a non-admin caller and deletes nothing', async () => {
    signIn('JURY')

    const response = await DELETE({} as NextRequest, buildContext())
    const json = await response.json()

    expect(response.status).toBe(403)
    expect(json.code).toBe('FORBIDDEN')
    expect(mockDeleteProject).not.toHaveBeenCalled()
  })

  it('returns 403 for an unauthenticated caller and deletes nothing', async () => {
    mockAuth.mockResolvedValueOnce(null as never)

    const response = await DELETE({} as NextRequest, buildContext())

    expect(response.status).toBe(403)
    expect(mockDeleteProject).not.toHaveBeenCalled()
  })

  it('returns 404 NOT_FOUND for an unknown project and deletes nothing', async () => {
    mockProjectFindUnique.mockResolvedValueOnce(null as never)

    const response = await DELETE({} as NextRequest, buildContext('does-not-exist'))
    const json = await response.json()

    expect(response.status).toBe(404)
    expect(json.code).toBe('NOT_FOUND')
    expect(mockDeleteProject).not.toHaveBeenCalled()
  })
})

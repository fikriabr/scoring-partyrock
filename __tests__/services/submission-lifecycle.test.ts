/**
 * Unit Tests: deleteProject and cancelProcessing (lib/services/submission.service.ts)
 *
 * deleteProject — soft-deletes by stamping `deletedAt`. Crawl metadata, AI
 * scores and jury scores are never touched, so a mistaken delete stays
 * recoverable in the database (no rows are removed).
 *
 * cancelProcessing — force-fails whichever of crawl/score is stuck in
 * PENDING/PROCESSING, and only that one: a project mid-crawl with an
 * already-scored history must keep its score status untouched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    project: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { db } from '@/lib/db'
import { deleteProject, cancelProcessing } from '@/lib/services/submission.service'

const mockProjectFindUniqueOrThrow = vi.mocked(db.project.findUniqueOrThrow)
const mockProjectUpdate = vi.mocked(db.project.update)

const PROJECT_ID = 'project-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('deleteProject', () => {
  it('stamps deletedAt instead of removing the row', async () => {
    mockProjectUpdate.mockResolvedValueOnce({ id: PROJECT_ID } as never)

    await deleteProject(PROJECT_ID)

    expect(mockProjectUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: PROJECT_ID },
      data: { deletedAt: expect.any(Date) },
    })
  })

  it('propagates an update failure', async () => {
    mockProjectUpdate.mockRejectedValueOnce(new Error('row not found'))

    await expect(deleteProject(PROJECT_ID)).rejects.toThrow('row not found')
  })
})

describe('cancelProcessing', () => {
  it('force-fails both pipelines when both are stuck', async () => {
    mockProjectFindUniqueOrThrow.mockResolvedValueOnce({
      crawlStatus: 'PROCESSING',
      scoreStatus: 'PENDING',
    } as never)
    mockProjectUpdate.mockResolvedValueOnce({
      id: PROJECT_ID,
      crawlStatus: 'FAILED',
      scoreStatus: 'FAILED',
    } as never)

    const result = await cancelProcessing(PROJECT_ID)

    expect(mockProjectUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: PROJECT_ID },
      data: {
        crawlStatus: 'FAILED',
        crawlError: 'Cancelled by admin.',
        scoreStatus: 'FAILED',
      },
      select: { id: true, crawlStatus: true, scoreStatus: true },
    })
    expect(result).toEqual({ id: PROJECT_ID, crawlStatus: 'FAILED', scoreStatus: 'FAILED' })
  })

  it('only touches the pipeline that is actually stuck', async () => {
    mockProjectFindUniqueOrThrow.mockResolvedValueOnce({
      crawlStatus: 'SUCCESS',
      scoreStatus: 'PROCESSING',
    } as never)
    mockProjectUpdate.mockResolvedValueOnce({
      id: PROJECT_ID,
      crawlStatus: 'SUCCESS',
      scoreStatus: 'FAILED',
    } as never)

    await cancelProcessing(PROJECT_ID)

    expect(mockProjectUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: PROJECT_ID },
      data: { scoreStatus: 'FAILED' },
      select: { id: true, crawlStatus: true, scoreStatus: true },
    })
  })

  it('writes nothing when neither pipeline is stuck', async () => {
    mockProjectFindUniqueOrThrow.mockResolvedValueOnce({
      crawlStatus: 'SUCCESS',
      scoreStatus: 'SUCCESS',
    } as never)
    mockProjectUpdate.mockResolvedValueOnce({
      id: PROJECT_ID,
      crawlStatus: 'SUCCESS',
      scoreStatus: 'SUCCESS',
    } as never)

    await cancelProcessing(PROJECT_ID)

    expect(mockProjectUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: PROJECT_ID },
      data: {},
      select: { id: true, crawlStatus: true, scoreStatus: true },
    })
  })
})

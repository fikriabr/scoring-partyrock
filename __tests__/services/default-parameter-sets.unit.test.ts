/**
 * Unit Tests: default parameter set (PARTYROCK)
 *
 *   - The default set totals exactly 100% weight.
 *   - The caller may load it explicitly or via the default argument.
 *
 * The expectations below are pinned verbatim on purpose: they are a
 * regression guard, so any edit to the template — including a reworded
 * description — has to fail here first and be a conscious decision.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock the Prisma db singleton BEFORE importing the service under test.
// ---------------------------------------------------------------------------
vi.mock('@/lib/db', () => {
  const db = {
    parameter: {
      createMany: vi.fn(),
    },
  }
  return { db, prisma: db }
})

// The server action pulls in NextAuth and the Next cache; both are stubbed so
// the validation path can be exercised without a request context.
vi.mock('@/lib/auth/config', () => ({
  auth: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { db } from '@/lib/db'
import { auth } from '@/lib/auth/config'
import {
  DEFAULT_PARAMETER_SETS,
  DEFAULT_PARAMETER_SET_NAMES,
  getDefaultParameterSet,
  isDefaultParameterSet,
  loadDefaultParameters,
  type DefaultParameterSet,
} from '@/lib/services/category.service'
import { loadDefaultParametersAction } from '@/actions/parameter.actions'

const mockCreateMany = vi.mocked(db.parameter.createMany)
const mockAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>

/** The `data` array handed to the single `createMany` call. */
function seededParameters(): Array<Record<string, unknown>> {
  expect(mockCreateMany).toHaveBeenCalledOnce()
  const args = mockCreateMany.mock.calls[0][0] as {
    data: Array<Record<string, unknown>>
  }
  return args.data
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreateMany.mockResolvedValue({ count: 5 } as never)
  mockAuth.mockResolvedValue({ user: { role: 'ADMIN' } })
})

describe('default parameter sets — total weight', () => {
  it.each(DEFAULT_PARAMETER_SET_NAMES)(
    'set %s totals exactly 100 percent weight',
    (set) => {
      const total = DEFAULT_PARAMETER_SETS[set].reduce(
        (sum, p) => sum + p.weight,
        0,
      )
      expect(total).toBe(100)
    },
  )

  it('exposes exactly the PARTYROCK set', () => {
    expect([...DEFAULT_PARAMETER_SET_NAMES]).toEqual(['PARTYROCK'])
  })

  it('getDefaultParameterSet returns a set whose weights total 100%', () => {
    for (const set of DEFAULT_PARAMETER_SET_NAMES) {
      const parameters = getDefaultParameterSet(set)
      expect(parameters).toHaveLength(5)
      expect(parameters.reduce((sum, p) => sum + p.weight, 0)).toBe(100)
    }
  })
})

describe('PARTYROCK set — regression guard', () => {
  const expected = [
    {
      name: 'Creativity & Originality',
      description: 'How creative and original is the application compared to others?',
      weight: 20,
      orderIndex: 0,
    },
    {
      name: 'Problem-Solution Fit',
      description: 'How well does the application address a real problem?',
      weight: 25,
      orderIndex: 1,
    },
    {
      name: 'Effective Use of PartyRock Features',
      description: 'How effectively does the application leverage PartyRock widgets?',
      weight: 20,
      orderIndex: 2,
    },
    {
      name: 'User Experience & Presentation',
      description: 'How clear and compelling is the application presentation?',
      weight: 20,
      orderIndex: 3,
    },
    {
      name: 'Impact & Scalability',
      description: 'What is the potential impact and scalability of the application?',
      weight: 15,
      orderIndex: 4,
    },
  ]

  it('keeps every name, description, weight and order position', () => {
    expect(
      DEFAULT_PARAMETER_SETS.PARTYROCK.map((p) => ({
        name: p.name,
        description: p.description,
        weight: p.weight,
        orderIndex: p.orderIndex,
      })),
    ).toEqual(expected)
  })

  it('keeps the AUTO scoring mode and 0-100 score range on every parameter', () => {
    for (const p of DEFAULT_PARAMETER_SETS.PARTYROCK) {
      expect(p.scoringMode).toBe('AUTO')
      expect(p.minScore).toBe(0)
      expect(p.maxScore).toBe(100)
    }
  })
})

describe('loadDefaultParameters — default argument', () => {
  it('seeds the PARTYROCK set when no set is given', async () => {
    await loadDefaultParameters('cat_default')

    const data = seededParameters()
    expect(data.map((p) => p.name)).toEqual([
      'Creativity & Originality',
      'Problem-Solution Fit',
      'Effective Use of PartyRock Features',
      'User Experience & Presentation',
      'Impact & Scalability',
    ])
    // Every row carries the categoryId, and duplicates stay skipped.
    expect(data.every((p) => p.categoryId === 'cat_default')).toBe(true)
    expect(mockCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    )
  })

  it('seeds the same rows for an explicit PARTYROCK as for the default', async () => {
    await loadDefaultParameters('cat_explicit')
    const explicitData = seededParameters()

    vi.clearAllMocks()
    mockCreateMany.mockResolvedValue({ count: 5 } as never)

    await loadDefaultParameters('cat_explicit', 'PARTYROCK')
    expect(seededParameters()).toEqual(explicitData)
  })
})

describe('unknown set names are rejected', () => {
  const unknownValues = ['html', 'PARTYROCK ', 'REACT', '', 'toString', null, 42]

  it('isDefaultParameterSet accepts only the known names', () => {
    for (const set of DEFAULT_PARAMETER_SET_NAMES) {
      expect(isDefaultParameterSet(set)).toBe(true)
    }
    for (const value of unknownValues) {
      expect(isDefaultParameterSet(value)).toBe(false)
    }
  })

  it('loadDefaultParameters throws a clear error and touches no rows', async () => {
    for (const value of unknownValues) {
      await expect(
        loadDefaultParameters('cat_bad', value as unknown as DefaultParameterSet),
      ).rejects.toThrow(/Unknown default parameter set/)
    }
    expect(mockCreateMany).not.toHaveBeenCalled()
  })

  it('loadDefaultParametersAction returns a failure instead of seeding', async () => {
    const result = await loadDefaultParametersAction(
      'cat_bad',
      'REACT' as unknown as DefaultParameterSet,
    )

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/Unknown default parameter set/)
    expect(result.message).toContain('PARTYROCK')
    expect(mockCreateMany).not.toHaveBeenCalled()
  })
})

describe('loadDefaultParametersAction', () => {
  it('seeds PARTYROCK when the set argument is omitted', async () => {
    const result = await loadDefaultParametersAction('cat_action_default')

    expect(result.success).toBe(true)
    expect(seededParameters().map((p) => p.name)).toContain(
      'Effective Use of PartyRock Features',
    )
  })

  it('rejects a non-admin caller before any set validation', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'JURY' } })

    const result = await loadDefaultParametersAction('cat_forbidden', 'PARTYROCK')

    expect(result.success).toBe(false)
    expect(result.message).toMatch(/Forbidden/)
    expect(mockCreateMany).not.toHaveBeenCalled()
  })
})

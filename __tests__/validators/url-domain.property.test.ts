/**
 * Property-based tests for Property 5: URL Domain Validation
 *
 * Validates: Requirements 3.2
 *
 * Property 5 states:
 *   For any submitted URL string, the system SHALL accept it if and only if the
 *   URL is well-formed and its domain starts with `partyrock.aws`. All other URLs
 *   SHALL be rejected with a validation error.
 *
 * Concretely, the system accepts:
 *   - Exact domain: `partyrock.aws`
 *   - Subdomains:   `*.partyrock.aws` (e.g. `app.partyrock.aws`)
 *
 * And rejects every other well-formed (or malformed) URL.
 *
 * **Validates: Requirements 3.2**
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { SubmissionSchema, CsvRowSchema } from '@/lib/validators/schemas'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Validate only the URL field of SubmissionSchema */
function isUrlAcceptedBySubmission(url: string): boolean {
  const result = SubmissionSchema.safeParse({
    url,
    participantName: 'Test Participant',
    categoryId: 'clabcdef0001',
  })
  return result.success
}

/** Validate only the URL field of CsvRowSchema */
function isUrlAcceptedByCsv(url: string): boolean {
  const result = CsvRowSchema.safeParse({
    url,
    participantName: 'Test Participant',
    categoryId: 'clabcdef0001',
    teamName: null,
    sourceCode: null,
  })
  return result.success
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** URL paths: e.g. '', '/', '/app/some-path', '/path?foo=bar' */
const pathArbitrary = fc.oneof(
  fc.constant(''),
  fc.constant('/'),
  fc.stringMatching(/^\/[a-z0-9\-/]{0,30}$/).filter((s) => s.length > 0),
)

/**
 * Generates a well-formed HTTPS URL with hostname === 'partyrock.aws'.
 * These MUST pass validation.
 */
const exactPartyRockUrlArbitrary: fc.Arbitrary<string> = pathArbitrary.map(
  (path) => `https://partyrock.aws${path}`,
)

/**
 * Generates a well-formed HTTPS URL with a single-segment subdomain of
 * partyrock.aws (e.g. https://app.partyrock.aws/something).
 * These MUST pass validation.
 */
const subdomainPartyRockUrlArbitrary: fc.Arbitrary<string> = fc
  .tuple(
    // subdomain label: 1–20 lowercase alphanumeric chars or hyphens, not starting/ending with hyphen
    fc.stringMatching(/^[a-z0-9][a-z0-9\-]{0,18}[a-z0-9]$/).filter((s) => s.length >= 1),
    pathArbitrary,
  )
  .map(([sub, path]) => `https://${sub}.partyrock.aws${path}`)

/**
 * Generates HTTPS URLs whose hostname is a completely different domain —
 * not partyrock.aws and not a subdomain of partyrock.aws.
 * These MUST fail validation.
 */
const nonPartyRockDomainArbitrary: fc.Arbitrary<string> = fc
  .oneof(
    // well-known other domains
    fc.constantFrom(
      'google.com',
      'amazon.com',
      'aws.amazon.com',
      'evil.com',
      'partyrock.com',        // similar but wrong TLD
      'partyrock.aws.evil.com', // partyrock.aws appears as a label, not as hostname
      'mypartyrock.aws',      // 'mypartyrock' is not 'partyrock'
      'fakepartyrock.aws',
      'notpartyrock.aws',
    ),
    // random hostname: 3–20 lowercase letters followed by a generic TLD
    fc
      .tuple(
        fc.stringMatching(/^[a-z]{3,15}$/),
        fc.constantFrom('.com', '.net', '.org', '.io', '.dev', '.co'),
      )
      .map(([label, tld]) => `${label}${tld}`)
      .filter((h) => h !== 'partyrock.aws'),
  )
  .map((host) => `https://${host}/some-path`)

/**
 * Generates strings that are clearly not valid URLs (unparseable or missing scheme).
 * These MUST fail validation because `z.string().url()` rejects them.
 *
 * Note: ftp://partyrock.aws/ is NOT included here because z.string().url() accepts
 * it and the domain check would then pass — the schema only validates the hostname,
 * not the scheme. This is correct behaviour per Requirement 3.2.
 */
const malformedUrlArbitrary: fc.Arbitrary<string> = fc.oneof(
  fc.constant('not-a-url'),
  fc.constant('partyrock.aws'),          // missing scheme — not a valid URL
  fc.constant('//partyrock.aws/app'),    // missing scheme — not a valid URL
  fc.string().filter((s) => {
    // Only include strings that are truly unparseable as a URL
    try {
      new URL(s)
      return false // skip valid URLs in this bucket
    } catch {
      // Exclude empty string — zod min(1) handles it differently
      return s.length > 0
    }
  }),
)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Property 5: URL Domain Validation — SubmissionSchema', () => {
  /**
   * Property 5a (positive): Any well-formed HTTPS URL on partyrock.aws (exact)
   * MUST be accepted by SubmissionSchema.
   *
   * **Validates: Requirements 3.2**
   */
  it('accepts any HTTPS URL on the exact partyrock.aws domain', () => {
    fc.assert(
      fc.property(exactPartyRockUrlArbitrary, (url) => {
        expect(isUrlAcceptedBySubmission(url)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  /**
   * Property 5b (positive): Any well-formed HTTPS URL on a subdomain of
   * partyrock.aws MUST be accepted by SubmissionSchema.
   *
   * **Validates: Requirements 3.2**
   */
  it('accepts any HTTPS URL on a *.partyrock.aws subdomain', () => {
    fc.assert(
      fc.property(subdomainPartyRockUrlArbitrary, (url) => {
        expect(isUrlAcceptedBySubmission(url)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  /**
   * Property 5c (negative): Any URL whose hostname is NOT partyrock.aws and
   * NOT a subdomain of partyrock.aws MUST be rejected by SubmissionSchema.
   *
   * **Validates: Requirements 3.2**
   */
  it('rejects any URL whose domain is not partyrock.aws or a subdomain thereof', () => {
    fc.assert(
      fc.property(nonPartyRockDomainArbitrary, (url) => {
        expect(isUrlAcceptedBySubmission(url)).toBe(false)
      }),
      { numRuns: 200 },
    )
  })

  /**
   * Property 5d (negative): Malformed / non-URL strings MUST be rejected.
   *
   * **Validates: Requirements 3.2**
   */
  it('rejects malformed or non-URL strings', () => {
    fc.assert(
      fc.property(malformedUrlArbitrary, (url) => {
        expect(isUrlAcceptedBySubmission(url)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})

describe('Property 5: URL Domain Validation — CsvRowSchema', () => {
  /**
   * CsvRowSchema must apply the same URL domain logic as SubmissionSchema.
   *
   * **Validates: Requirements 3.2**
   */
  it('accepts any HTTPS URL on the exact partyrock.aws domain', () => {
    fc.assert(
      fc.property(exactPartyRockUrlArbitrary, (url) => {
        expect(isUrlAcceptedByCsv(url)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('accepts any HTTPS URL on a *.partyrock.aws subdomain', () => {
    fc.assert(
      fc.property(subdomainPartyRockUrlArbitrary, (url) => {
        expect(isUrlAcceptedByCsv(url)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('rejects any URL whose domain is not partyrock.aws or a subdomain thereof', () => {
    fc.assert(
      fc.property(nonPartyRockDomainArbitrary, (url) => {
        expect(isUrlAcceptedByCsv(url)).toBe(false)
      }),
      { numRuns: 200 },
    )
  })

  it('rejects malformed or non-URL strings', () => {
    fc.assert(
      fc.property(malformedUrlArbitrary, (url) => {
        expect(isUrlAcceptedByCsv(url)).toBe(false)
      }),
      { numRuns: 100 },
    )
  })
})

// ---------------------------------------------------------------------------
// Deterministic edge-case unit tests (complement the property tests)
// ---------------------------------------------------------------------------

describe('Property 5: URL Domain Validation — deterministic edge cases', () => {
  const acceptedUrls = [
    'https://partyrock.aws',
    'https://partyrock.aws/',
    'https://partyrock.aws/app/123',
    'https://partyrock.aws/app?foo=bar',
    'https://app.partyrock.aws',
    'https://app.partyrock.aws/',
    'https://my-app.partyrock.aws/path',
    'https://sub.partyrock.aws/app/abc?x=1',
  ]

  const rejectedUrls = [
    // wrong domain
    'https://google.com',
    'https://amazon.com',
    'https://partyrock.com',          // wrong TLD
    'https://mypartyrock.aws',        // prefix differs
    'https://fakepartyrock.aws',
    'https://notpartyrock.aws',
    // partyrock.aws embedded in path or deeper subdomain label but not the hostname
    'https://partyrock.aws.evil.com', // hostname is partyrock.aws.evil.com
    'https://evil.com/partyrock.aws', // partyrock.aws is just a path segment
    // malformed
    'partyrock.aws',
    '//partyrock.aws',
    '',
    'not-a-url',
    'http://',
  ]

  it.each(acceptedUrls)('accepts: %s', (url) => {
    expect(isUrlAcceptedBySubmission(url)).toBe(true)
    expect(isUrlAcceptedByCsv(url)).toBe(true)
  })

  it.each(rejectedUrls)('rejects: %s', (url) => {
    expect(isUrlAcceptedBySubmission(url)).toBe(false)
    expect(isUrlAcceptedByCsv(url)).toBe(false)
  })
})

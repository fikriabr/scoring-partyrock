/**
 * Unit tests for the shared URL rule module.
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.5
 */

import { describe, it, expect } from 'vitest'
import { isPartyRockHost, validateProjectUrl } from '@/lib/validators/url-rules'

describe('isPartyRockHost', () => {
  it.each(['partyrock.aws', 'app.partyrock.aws', 'my-app.partyrock.aws', 'a.b.partyrock.aws'])(
    'accepts %s',
    (host) => {
      expect(isPartyRockHost(host)).toBe(true)
    },
  )

  it.each([
    'partyrock.com',
    'mypartyrock.aws',
    'fakepartyrock.aws',
    'partyrock.aws.evil.com',
    'google.com',
    '',
  ])('rejects %s', (host) => {
    expect(isPartyRockHost(host)).toBe(false)
  })
})

describe('validateProjectUrl', () => {
  it.each([
    'https://partyrock.aws',
    'https://partyrock.aws/app/123',
    'http://partyrock.aws/app',
    'https://app.partyrock.aws/demo?x=1',
  ])('accepts %s', (url) => {
    expect(validateProjectUrl(url)).toEqual({ ok: true })
  })

  it('rejects a non-PartyRock host with the PartyRock rule message', () => {
    expect(validateProjectUrl('https://google.com')).toEqual({
      ok: false,
      message: 'URL must be a valid PartyRock URL (domain: partyrock.aws)',
    })
  })

  it('rejects a partyrock.aws URL on a non-web scheme', () => {
    expect(validateProjectUrl('ftp://partyrock.aws/')).toEqual({
      ok: false,
      message: 'URL must use http or https',
    })
  })
})

describe('validateProjectUrl — unparseable input', () => {
  it.each(['', 'not-a-url', 'partyrock.aws', '//partyrock.aws/app', 'http://'])(
    'rejects %s',
    (url) => {
      expect(validateProjectUrl(url)).toEqual({
        ok: false,
        message: 'URL must be a valid URL',
      })
    },
  )
})

// lib/validators/url-rules.ts
//
// Single source of truth for project URL rules.
//
// This module is imported from BOTH the server (zod schemas, API routes) and
// the client (`components/SubmissionForm.tsx`), so it must stay free of any
// server-only dependency: no `@/lib/db`, no `'use server'`, no Node built-ins.

/** Only real web schemes are accepted. */
const ALLOWED_SCHEMES = ['http:', 'https:']

/**
 * True when `hostname` is the PartyRock domain itself or one of its
 * subdomains. Compares the parsed hostname, never the raw URL string, so
 * `partyrock.aws.evil.com` and `https://evil.com/partyrock.aws` do not match.
 */
export function isPartyRockHost(hostname: string): boolean {
  return hostname === 'partyrock.aws' || hostname.endsWith('.partyrock.aws')
}

export type UrlValidationResult = { ok: true } | { ok: false; message: string }

/**
 * Validates a project URL: must parse as a URL, use the `http:` or `https:`
 * scheme, and have a hostname of `partyrock.aws` or `*.partyrock.aws`.
 */
export function validateProjectUrl(url: string): UrlValidationResult {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, message: 'URL must be a valid URL' }
  }
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    return { ok: false, message: 'URL must use http or https' }
  }
  if (!isPartyRockHost(parsed.hostname)) {
    return {
      ok: false,
      message: 'URL must be a valid PartyRock URL (domain: partyrock.aws)',
    }
  }
  return { ok: true }
}

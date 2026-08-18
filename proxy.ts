// proxy.ts
// RBAC proxy for Next.js App Router (formerly middleware.ts — renamed in Next 16).
// Uses the testable `checkAccess` function from lib/auth/rbac.ts so that
// access-control logic can be property-tested independently of Next.js internals.

import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { checkAccess } from '@/lib/auth/rbac'
import type { Role } from '@/lib/auth/rbac'

export default async function proxy(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  })

  const role = token?.role as Role | undefined
  const decision = checkAccess(request.nextUrl.pathname, role ?? null)

  if (!decision.allowed) {
    if (decision.reason === 'unauthenticated') {
      // Redirect unauthenticated users to the sign-in page
      return NextResponse.redirect(new URL('/login', request.url))
    }

    if (decision.reason === 'forbidden') {
      // Authenticated but insufficient role — return 403 JSON
      return NextResponse.json(
        { error: 'Forbidden', message: 'Akses ditolak.', code: 'FORBIDDEN' },
        { status: 403 },
      )
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match /admin/:path*, /jury/:path*, and /api/:path* but exclude:
     *   - /api/auth/...     (NextAuth internal endpoints — must stay public)
     *   - /public/...       (public leaderboard pages — no auth required)
     *   - /api/capture/...  (shared-token auth, enforced in the route itself
     *                        via lib/capture-auth.ts — the Playwright
     *                        navigator and the in-page panel have no session
     *                        cookie to present)
     */
    '/admin/:path*',
    '/jury/:path*',
    '/api/((?!auth/|public/|capture).*)',
  ],
}

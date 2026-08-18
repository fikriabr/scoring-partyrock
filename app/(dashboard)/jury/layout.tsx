// app/(dashboard)/jury/layout.tsx
// RSC layout for jury dashboard pages.
// Checks session server-side and redirects to login if not authenticated.
// Requirements: 6.1, 7.6

import { auth } from '@/lib/auth/config'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { ReactNode } from 'react'

export default async function JuryLayout({
  children,
}: {
  children: ReactNode
}) {
  const session = await auth()

  if (!session) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar navigation */}
      <aside className="w-64 bg-indigo-900 text-white p-4">
        <h1 className="text-xl font-bold mb-6">Jury Panel</h1>
        <nav>
          <ul className="space-y-2">
            <li>
              <Link
                href="/jury/projects"
                className="block px-3 py-2 rounded hover:bg-indigo-700"
              >
                Projects
              </Link>
            </li>
          </ul>
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-6 bg-gray-50">{children}</main>
    </div>
  )
}

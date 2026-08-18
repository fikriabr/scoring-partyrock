// app/layout.tsx
// Root layout for the Next.js App Router application.

import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PartyRock Assessment Tool',
  description: 'Sistem penjurian untuk project PartyRock',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="id">
      <body className="antialiased bg-gray-50 text-gray-900">{children}</body>
    </html>
  )
}

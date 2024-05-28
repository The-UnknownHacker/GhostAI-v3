import {
  ClerkProvider,
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton
} from '@clerk/nextjs'
import './globals.css'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import ThemeProvider from '@/components/ThemeProvider'
import StoreProvider from '@/components/StoreProvider'
import I18Provider from '@/components/I18nProvider'
import { isUndefined } from 'lodash-es'

import 'katex/dist/katex.min.css'
import 'highlight.js/styles/a11y-light.css'

const HEAD_SCRIPTS = process.env.HEAD_SCRIPTS as string
const ENABLE_PROTECT = !isUndefined(process.env.ACCESS_PASSWORD)

export const metadata: Metadata = {
  title: 'GhostAI',
  description: 'GhostAI',
  keywords: ['Gemini', 'Gemini Pro', 'Gemini Chat', 'AI', 'voice', 'Free Chatgpt', 'Chatgpt'],
  icons: {
    icon: {
      type: 'image/svg+xml',
      url: '/logo.svg',
    },
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1.0,
  minimumScale: 1.0,
  maximumScale: 1.0,
  viewportFit: 'cover',
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>{HEAD_SCRIPTS ? <Script id="headscript">{HEAD_SCRIPTS}</Script> : null}</head>
        <body className="bg-background text-foreground">
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <StoreProvider isProtected={ENABLE_PROTECT}>
              <I18Provider>
                <SignedOut>
                  <div className="flex flex-col items-center justify-center h-screen text-center">
                    <h1 className="text-4xl mb-4">Welcome to GhostAI</h1>
                    <SignInButton className="bg-primary text-primary-foreground px-6 py-3 rounded-lg hover:bg-primary/80">
                      Sign in to continue
                    </SignInButton>
                  </div>
                </SignedOut>
                <SignedIn>
                  <UserButton />
                  {children}
                </SignedIn>
              </I18Provider>
            </StoreProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}

import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import ThemeProvider from '@/components/ThemeProvider';
import StoreProvider from '@/components/StoreProvider';
import I18Provider from '@/components/I18nProvider';
import { isUndefined } from 'lodash-es';
import { ClerkProvider, SignInButton, SignedIn, SignedOut } from '@clerk/nextjs';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/a11y-light.css';
import './globals.css';

const HEAD_SCRIPTS = process.env.HEAD_SCRIPTS as string;
const ENABLE_PROTECT = !isUndefined(process.env.ACCESS_PASSWORD);

export const metadata: Metadata = {
  title: 'GhostAI',
  description: 'GhostAI',
  keywords: ['Gemini', 'Gemini Pro', 'Gemini Chat', 'AI', 'voice'],
  icons: {
    icon: {
      type: 'image/x-icon',
      url: 'https://raw.githubusercontent.com/The-UnknownHacker/GhostAI-v2/main/client/src/favicon.ico',
    },
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1.0,
  minimumScale: 1.0,
  maximumScale: 1.0,
  viewportFit: 'cover',
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          {HEAD_SCRIPTS ? <Script id="headscript">{HEAD_SCRIPTS}</Script> : null}
          <link rel="icon" href="/favicon.ico" type="image/x-icon" />
          <title>GhostAI</title>
        </head>
        <body>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            <StoreProvider isProtected={ENABLE_PROTECT}>
              <I18Provider>
                <SignedOut>
                  <div style={signedOutStyle}>
                    <h1 style={welcomeTextStyle}>Welcome To GhostAI</h1>
                    <SignInButton>
                      <button style={signInButtonStyle}>Login to continue</button>
                    </SignInButton>
                  </div>
                </SignedOut>
                <SignedIn>
                  {children}
                </SignedIn>
              </I18Provider>
            </StoreProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}

const signedOutStyle = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
  backgroundColor: 'black',
  color: 'white',
};

const welcomeTextStyle = {
  fontWeight: 'bold' as const,
  fontSize: '2em',
  marginBottom: '20px',
};

const signInButtonStyle = {
  backgroundColor: 'white',
  color: 'black',
  padding: '10px 20px',
  borderRadius: '5px',
  cursor: 'pointer',
  border: 'none',
  textAlign: 'center' as const,
};

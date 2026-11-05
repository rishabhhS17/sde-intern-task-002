import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export const Route = createRootRoute({
  component: RootLayout,
  // Last line of defence: if any render throws, show this instead of a blank page.
  errorComponent: ({ error, reset }) => (
    <RootLayout>
      <div className="notice notice-error" role="alert">
        <p>Something went wrong: {error instanceof Error ? error.message : 'unknown error'}</p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </RootLayout>
  ),
  notFoundComponent: () => (
    <p>
      This page does not exist. <Link to="/">Go to the start page</Link>
    </p>
  ),
})

function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="app-title">
          Bill Splitter
        </Link>
      </header>
      <main>{children ?? <Outlet />}</main>
    </div>
  )
}

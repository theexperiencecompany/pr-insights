import type { ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'

import { avatarUrl, getStatus } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { cn } from '@/lib/utils'

import { SyncStatus } from './sync-status'
import { ThemeToggle } from './theme-toggle'

const NAV_ITEMS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/leaderboards', label: 'Leaderboards', end: false },
  { to: '/contributors', label: 'Contributors', end: false },
  { to: '/insights', label: 'Insights', end: false },
  { to: '/pulls', label: 'Pull requests', end: false },
]

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto mt-4 max-w-[1280px] px-6">
      <div className="rounded-md px-4 py-2 text-sm">{children}</div>
    </div>
  )
}

export function Layout() {
  const { data: status } = useApi(getStatus)

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="bg-header-bg">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            {status ? (
              <img
                src={avatarUrl(status.org)}
                alt=""
                className="size-5 rounded-full"
              />
            ) : null}
            <span className="font-semibold text-white">PR Insights</span>
          </Link>
          <nav className="flex items-center gap-5">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'text-sm text-white/70 transition-colors hover:text-white',
                    isActive && 'font-semibold text-white',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <SyncStatus />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {status && status.repoErrors > 0 ? (
        <Banner>
          <div className="rounded-md bg-[#fff8c5] px-4 py-2 text-[#9a6700] dark:bg-[#bb800926] dark:text-[#d29922]">
            {status.repoErrors} repositor
            {status.repoErrors === 1 ? 'y' : 'ies'} failed to sync — data may be
            incomplete.
          </div>
        </Banner>
      ) : null}
      {status && status.lastError ? (
        <Banner>
          <div className="rounded-md bg-[#ffebe9] px-4 py-2 text-[#cf222e] dark:bg-[#da363326] dark:text-[#ff7b72]">
            Last sync failed: {status.lastError}
          </div>
        </Banner>
      ) : null}

      <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-[1280px] px-6 py-4 text-xs text-muted-foreground">
          PR Insights · theexperiencecompany · Built on GitHub&apos;s data, Primer
          design tokens
        </div>
      </footer>
    </div>
  )
}

import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { Layout } from '@/components/layout'
import ContributorPage from '@/pages/contributor'
import InsightsPage from '@/pages/insights'
import OverviewPage from '@/pages/overview'
import PeoplePage from '@/pages/people'
import PullsPage from '@/pages/pulls'
import { Loading } from '@/components/loading'

// Code-split Entire: heavy recharts + agent analytics, isolated chunk.
const EntirePage = lazy(() => import('@/pages/entire'))

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="leaderboards" element={<Navigate to="/pulls?sort=diff" replace />} />
        <Route path="contributors" element={<Navigate to="/people" replace />} />
        <Route path="contributors/:login" element={<ContributorPage />} />
        <Route path="people" element={<PeoplePage />} />
        <Route path="people/:login" element={<ContributorPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route
          path="entire"
          element={
            <Suspense fallback={<Loading />}>
              <EntirePage />
            </Suspense>
          }
        />
        <Route path="pulls" element={<PullsPage />} />
      </Route>
    </Routes>
  )
}

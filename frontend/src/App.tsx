import { Route, Routes } from 'react-router-dom'

import { Layout } from '@/components/layout'
import ContributorPage from '@/pages/contributor'
import ContributorsPage from '@/pages/contributors'
import InsightsPage from '@/pages/insights'
import LeaderboardsPage from '@/pages/leaderboards'
import OverviewPage from '@/pages/overview'
import PullsPage from '@/pages/pulls'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="leaderboards" element={<LeaderboardsPage />} />
        <Route path="contributors" element={<ContributorsPage />} />
        <Route path="contributors/:login" element={<ContributorPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="pulls" element={<PullsPage />} />
      </Route>
    </Routes>
  )
}

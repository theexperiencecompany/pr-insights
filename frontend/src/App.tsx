import { Route, Routes } from 'react-router-dom'

import { Layout } from '@/components/layout'
import ContributorsPage from '@/pages/contributors'
import InsightsPage from '@/pages/insights'
import LeaderboardsPage from '@/pages/leaderboards'
import OverviewPage from '@/pages/overview'
import PullsPage from '@/pages/pulls'
import ReposPage from '@/pages/repos'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<OverviewPage />} />
        <Route path="leaderboards" element={<LeaderboardsPage />} />
        <Route path="contributors" element={<ContributorsPage />} />
        <Route path="repos" element={<ReposPage />} />
        <Route path="insights" element={<InsightsPage />} />
        <Route path="pulls" element={<PullsPage />} />
      </Route>
    </Routes>
  )
}

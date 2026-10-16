/**
 * The route table — the only place a URL is bound to a screen.
 *
 * Every `path` comes from the registry: `check-frontend-routing` compares the
 * two tables in both directions. There is no sign-in, so every screen sits under
 * the one dashboard shell.
 *
 * Pages are lazy: MUI and the grid are most of the bundle, and the shell should
 * paint before the screen's code arrives.
 */

import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import DashboardLayout from '@/layouts/dashboard/DashboardLayout'
import LoadingScreen from '@/components/loading-screen/LoadingScreen'
import { PATHS } from '@/routes/paths'

const ProjectPage = lazy(() => import('@/pages/ProjectPage'))

const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

export default function App() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path={PATHS.root} element={<Navigate to={PATHS.project} replace />} />
          <Route path={PATHS.project} element={<ProjectPage />} />
          {/* Inside the shell: a reader on a dead link keeps the nav to go elsewhere. */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

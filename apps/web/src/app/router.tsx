import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './AppShell';
import { LearnRoute } from '@/pages/LearnRoute';
import { GameRoute, PlayHome } from '@/pages/GameRoute';
import { StudioHome, StudioProjectRoute } from '@/pages/StudioRoutes';
import { CapacityRoute, CasesRoute, LibraryRoute, NotFound } from '@/pages/MiscRoutes';
import { LoginPage } from '@/pages/LoginPage';
import { AccountPage } from '@/pages/AccountPage';
import { SharePage } from '@/pages/SharePage';
import { ComparePage } from '@/features/compare/ComparePage';
import { LevelEditor } from '@/features/levels/LevelEditor';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/learn" replace /> },
      { path: 'learn', element: <LearnRoute /> },
      { path: 'learn/:lessonId', element: <LearnRoute /> },
      { path: 'play', element: <PlayHome /> },
      { path: 'play/*', element: <GameRoute /> },
      { path: 'levels/new', element: <LevelEditor /> },
      { path: 'levels/:id/edit', element: <LevelEditor /> },
      { path: 'studio', element: <StudioHome /> },
      { path: 'studio/:projectId', element: <StudioProjectRoute /> },
      { path: 'studio/:projectId/compare', element: <ComparePage /> },
      { path: 'cases', element: <CasesRoute /> },
      { path: 'library', element: <LibraryRoute /> },
      { path: 'capacity', element: <Navigate to="/capacity/sizing" replace /> },
      { path: 'capacity/:tab', element: <CapacityRoute /> },
      { path: 's/:slug', element: <SharePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './AppShell';
import { LearnRoute } from '@/pages/LearnRoute';
import { GameRoute, PlayHome } from '@/pages/GameRoute';
import { StudioHome, StudioProjectRoute } from '@/pages/StudioRoutes';
import { CapacityRoute, CasesRoute, LibraryRoute, NotFound } from '@/pages/MiscRoutes';
import { LoginPage } from '@/pages/LoginPage';
import { AccountPage } from '@/pages/AccountPage';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/learn" replace /> },
      { path: 'learn', element: <LearnRoute /> },
      { path: 'learn/:lessonId', element: <LearnRoute /> },
      { path: 'play', element: <PlayHome /> },
      { path: 'play/*', element: <GameRoute /> },
      { path: 'studio', element: <StudioHome /> },
      { path: 'studio/:projectId', element: <StudioProjectRoute /> },
      { path: 'cases', element: <CasesRoute /> },
      { path: 'library', element: <LibraryRoute /> },
      { path: 'capacity', element: <Navigate to="/capacity/sizing" replace /> },
      { path: 'capacity/:tab', element: <CapacityRoute /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

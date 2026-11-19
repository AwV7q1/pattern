import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './AppShell';
import { LearnRoute } from '@/pages/LearnRoute';
import { GameRoute, PlayHome } from '@/pages/GameRoute';
import { StudioHome, StudioProjectRoute } from '@/pages/StudioRoutes';
import { CapacityHome, CapacityRoute, CasesRoute, LibraryRoute, NotFound } from '@/pages/MiscRoutes';
import { LoginPage } from '@/pages/LoginPage';
import { AccountPage } from '@/pages/AccountPage';
import { SharePage } from '@/pages/SharePage';
import { ComparePage } from '@/features/compare/ComparePage';
import { LevelEditor } from '@/features/levels/LevelEditor';
import { INTERVIEW_HOME, InterviewRoute } from '@/features/interview/InterviewPages';
import { CardRun } from '@/cards/CardRun';
import { CardWiki } from '@/cards/CardWiki';
import { GlossaryPage } from '@/learn/Glossary';

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/learn" replace /> },
      { path: 'learn', element: <LearnRoute /> },
      { path: 'learn/:lessonId', element: <LearnRoute /> },
      { path: 'glossary', element: <GlossaryPage /> },
      { path: 'play', element: <PlayHome /> },
      { path: 'play/*', element: <GameRoute /> },
      { path: 'cards', element: <CardRun /> },
      { path: 'cards/wiki', element: <CardWiki /> },
      { path: 'interview', element: <Navigate to={INTERVIEW_HOME} replace /> },
      { path: 'interview/:promptId', element: <InterviewRoute /> },
      { path: 'levels/new', element: <LevelEditor /> },
      { path: 'levels/:id/edit', element: <LevelEditor /> },
      { path: 'studio', element: <StudioHome /> },
      { path: 'studio/:projectId', element: <StudioProjectRoute /> },
      { path: 'studio/:projectId/compare', element: <ComparePage /> },
      { path: 'cases', element: <CasesRoute /> },
      { path: 'library', element: <LibraryRoute /> },
      { path: 'capacity', element: <CapacityHome /> },
      { path: 'capacity/:tab', element: <CapacityRoute /> },
      { path: 's/:slug', element: <SharePage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

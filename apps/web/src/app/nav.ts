import {
  BookA,
  BookOpen,
  Boxes,
  Gamepad2,
  Gauge,
  GraduationCap,
  Library,
  Layers,
  MessagesSquare,
  Shapes,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Extra words for the command palette. */
  keywords?: string;
  /** Not a route: an action handled by the shell. */
  action?: 'glossary';
  /** Only shown once the feature exists on this build. */
  hidden?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: 'Học',
    items: [
      { to: '/learn', label: 'Lộ trình', icon: GraduationCap, keywords: 'learn bài học lesson duolingo' },
      { to: '/glossary', label: 'Từ điển', icon: BookA, keywords: 'glossary thuật ngữ term' },
    ],
  },
  {
    label: 'Luyện',
    items: [
      { to: '/play', label: 'Game', icon: Gamepad2, keywords: 'level chơi game sao leaderboard' },
      { to: '/cards', label: 'Thẻ bài', icon: Layers, keywords: 'card battle deckbuilder botnet thẻ bài beta' },
      { to: '/play#interview', label: 'Phỏng vấn', icon: MessagesSquare, keywords: 'interview system design đề bài' },
      { to: '/levels/new', label: 'Tạo level', icon: Wrench, keywords: 'level editor creator cộng đồng' },
    ],
  },
  {
    label: 'Thiết kế',
    items: [
      { to: '/studio', label: 'Dự án', icon: Shapes, keywords: 'studio sandbox project canvas' },
      { to: '/library', label: 'Thư viện công nghệ', icon: Library, keywords: 'tech redis kafka postgres nginx' },
      { to: '/cases', label: 'Case study', icon: BookOpen, keywords: 'discord slack netflix twitter figma' },
    ],
  },
  {
    label: 'Công cụ',
    items: [
      { to: '/capacity/sizing', label: 'Chọn server', icon: Boxes, keywords: 'sizing vps vcpu ram capacity' },
      { to: '/capacity/calibrate', label: 'Hiệu chỉnh k6', icon: Gauge, keywords: 'calibrate k6 load test' },
    ],
  },
  {
    label: 'Tài khoản',
    items: [{ to: '/account', label: 'Tài khoản', icon: UserRound, keywords: 'account login đăng nhập đồng bộ sync' }],
  },
];

export interface TabItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Paths that keep this tab highlighted (default: `to` and everything under it). */
  match?: string[];
}

/** Bottom tab bar: each tab opens the home page of one area. */
export const TABS: TabItem[] = [
  { to: '/learn', label: 'Học', icon: GraduationCap },
  { to: '/play', label: 'Game', icon: Gamepad2, match: ['/play', '/cards', '/interview', '/levels'] },
  { to: '/studio', label: 'Studio', icon: Shapes, match: ['/studio', '/library', '/cases', '/s'] },
  { to: '/capacity', label: 'Công suất', icon: Gauge, match: ['/capacity'] },
  { to: '/glossary', label: 'Từ điển', icon: BookA },
];

/**
 * Home pages (first layer): the tab bar is shown. Every other path is a detail
 * page (second layer): the tab bar slides away and the page has its own way back.
 */
export const HOME_PATHS = TABS.map((t) => t.to);

export const isHomePath = (pathname: string) => HOME_PATHS.includes(pathname.replace(/\/+$/, '') || '/');

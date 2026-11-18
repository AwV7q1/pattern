import {
  BookA,
  BookOpen,
  Boxes,
  Gamepad2,
  Gauge,
  GraduationCap,
  Library,
  MessagesSquare,
  Shapes,
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
      { to: '#glossary', label: 'Từ điển', icon: BookA, keywords: 'glossary thuật ngữ term', action: 'glossary' },
    ],
  },
  {
    label: 'Luyện',
    items: [
      { to: '/play', label: 'Game', icon: Gamepad2, keywords: 'level chơi game sao leaderboard' },
      { to: '/interview', label: 'Phỏng vấn', icon: MessagesSquare, keywords: 'interview system design đề bài', hidden: true },
      { to: '/levels/new', label: 'Tạo level', icon: Wrench, keywords: 'level editor creator cộng đồng', hidden: true },
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
];

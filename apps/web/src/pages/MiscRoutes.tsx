import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { CASES } from '@/presets';
import { CaseLibrary } from '@/cases/CaseLibrary';
import { CapacityPage } from '@/capacity/CapacityPage';
import { autoLayout } from '@/model/flow';
import { projectFromPreset, store } from '@/projects/store';
import { useUi } from '@/app/ui-store';
import type { Design, Preset } from '@/types';
import { LibraryPage } from './LibraryPage';

export function CasesRoute() {
  const navigate = useNavigate();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <CaseLibrary cases={CASES} onOpen={(p) => navigate(`/studio/${p.id}`)} />
      </div>
    </div>
  );
}

export function LibraryRoute() {
  return <LibraryPage />;
}

/** `/capacity/:tab`: sizing wizard and k6 calibration; results open as studio projects. */
export function CapacityRoute() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const lastDesign = useUi((s) => s.lastDesign);
  if (tab !== 'sizing' && tab !== 'calibrate') return <Navigate to="/capacity/sizing" replace />;
  const openInStudio = async (key: string, p: Preset) => {
    const created = projectFromPreset({ ...p, design: autoLayout(p.design) }, p.title, key);
    await store.put(created);
    navigate(`/studio/${created.id}`);
  };
  return (
    <CapacityPage
      tab={tab}
      onTab={(t) => navigate(`/capacity/${t}`)}
      sandboxDesign={lastDesign?.design ?? null}
      onOpenSizing={(r, title) => {
        if (!r.input) return;
        const t = r.input.scenario.traffic;
        openInStudio('custom-sizing', {
          title,
          description: `Đề xuất của Sizing wizard: Node cluster (1 process/vCPU) + Postgres, pool mỗi process. Cao điểm ${Math.round(t[0].rps)} rps; bật "Traffic theo kịch bản" để có đột biến ${Math.round(t[1]?.rps ?? 0)} rps ở giây 30–40. Thử tắt app server hoặc làm chậm DB.`,
          design: r.input.design,
          scenario: r.input.scenario,
        });
      }}
      onOpenCalibrated={(design: Design, title, slo) =>
        openInStudio('custom-calibrated', {
          title,
          description: 'Design đã hiệu chỉnh từ số đo k6. Kéo RPS để xem hệ thống phản ứng thế nào quanh giới hạn dự đoán.',
          design,
          scenario: { seed: 1, timeoutMs: 60000, traffic: [{ atMs: 0, rps: 500 }], slo: slo ?? { p99Ms: 200, errorRate: 0.01 }, windowMs: 1000 },
        })
      }
    />
  );
}

export function NotFound() {
  return (
    <div className="grid justify-items-start gap-2 p-6">
      <p className="text-sm">Không có trang này.</p>
      <Link to="/learn" className="text-sm text-primary underline">
        Về trang học
      </Link>
    </div>
  );
}

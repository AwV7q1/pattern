import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { Gauge, Server } from 'lucide-react';
import { BackLink, HubCard } from '@/components/BackLink';
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
      <div className="mx-auto grid max-w-6xl gap-2 px-6 py-8">
        <BackLink to="/studio" label="Studio" className="-ml-3 justify-self-start" />
        <CaseLibrary cases={CASES} onOpen={(p) => navigate(`/studio/${p.id}`)} />
      </div>
    </div>
  );
}

export function LibraryRoute() {
  return <LibraryPage />;
}

/** `/capacity`: home of the capacity tools. */
export function CapacityHome() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid max-w-3xl gap-6 px-6 py-8">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Gauge className="size-6 text-primary" /> Công suất
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tính cấu hình server cho tải thật, rồi kiểm chứng bằng mô phỏng. Kết quả mở thành dự án trong Studio.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <HubCard to="/capacity/sizing" icon={Server} accent="text-emerald-400" title="Chọn server (sizing)" cta="Bắt đầu">
            Từ tải mục tiêu và chi phí mỗi request đo được → số vCPU, RAM, pool, gói VPS; kiểm chứng bằng mô phỏng.
          </HubCard>
          <HubCard to="/capacity/calibrate" icon={Gauge} accent="text-sky-400" title="Hiệu chỉnh từ k6" cta="Bắt đầu">
            Từ kết quả load test thật → tham số mô hình khớp hệ thống của bạn và giới hạn chịu tải dự đoán.
          </HubCard>
        </div>
      </div>
    </div>
  );
}

/** `/capacity/:tab`: sizing wizard and k6 calibration; results open as studio projects. */
export function CapacityRoute() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const lastDesign = useUi((s) => s.lastDesign);
  if (tab !== 'sizing' && tab !== 'calibrate') return <Navigate to="/capacity" replace />;
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
      <BackLink label="Quay lại" className="-ml-3" />
      <p className="text-sm">Không có trang này.</p>
      <Link to="/learn" className="text-sm text-primary underline">
        Về trang học
      </Link>
    </div>
  );
}

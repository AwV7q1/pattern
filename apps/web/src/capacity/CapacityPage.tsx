import { useState } from 'react';
import { Gauge, Server } from 'lucide-react';
import type { Design, SizingReport } from '@/types';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SizingPanel } from './SizingPanel';
import { CalibratePanel, type DesignSource } from './CalibratePanel';

type Props = {
  sandboxDesign: Design | null;
  onOpenSizing: (report: SizingReport, title: string) => void;
  onOpenCalibrated: (design: Design, title: string, slo?: { p99Ms: number; errorRate: number }) => void;
};

/** Capacity planning: size servers from measured costs, or fit a design to k6 runs. */
export function CapacityPage({ sandboxDesign, onOpenSizing, onOpenCalibrated }: Props) {
  const [tab, setTab] = useState<'sizing' | 'calibrate'>('sizing');
  const [sizing, setSizing] = useState<SizingReport | null>(null);
  const sources: DesignSource[] = [];
  if (sandboxDesign) sources.push({ key: 'sandbox', label: 'Design đang mở ở Sandbox', design: sandboxDesign });
  if (sizing?.input) sources.push({ key: 'sizing', label: 'Đề xuất của Sizing wizard', design: sizing.input.design, slo: sizing.input.scenario.slo });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-4 border-b px-4 py-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="sizing">
              <Server /> Chọn server (sizing)
            </TabsTrigger>
            <TabsTrigger value="calibrate">
              <Gauge /> Hiệu chỉnh từ k6
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          {tab === 'sizing'
            ? 'Từ tải mục tiêu và chi phí mỗi request đo được → số vCPU, RAM, pool, gói VPS; kiểm chứng bằng mô phỏng.'
            : 'Từ kết quả load test thật → tham số mô hình khớp hệ thống của bạn và giới hạn chịu tải dự đoán.'}
        </p>
      </div>
      <div className={tab === 'sizing' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <SizingPanel onOpen={onOpenSizing} onReport={setSizing} />
      </div>
      <div className={tab === 'calibrate' ? 'flex min-h-0 flex-1' : 'hidden'}>
        <CalibratePanel sources={sources} onApply={onOpenCalibrated} />
      </div>
    </div>
  );
}

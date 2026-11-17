import { useState } from 'react';
import { ArrowLeft, ExternalLink, FlaskConical, Info } from 'lucide-react';
import type { CaseStudy } from '@/presets';
import { cn } from '@/lib/utils';
import { techOf } from '@/tech/catalog';
import { TechLogo } from '@/tech/TechLogo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Thumbnail } from '@/projects/Thumbnail';
import { projectFromPreset, store, type Project } from '@/projects/store';

const DISCLAIMER =
  'Mô hình đơn giản hoá dựa trên bài viết engineering công khai. Con số là minh hoạ để thấy cơ chế, không phải số liệu thật của công ty.';

function Logos({ c }: { c: CaseStudy }) {
  const ids = [...new Set(c.stages.flatMap((s) => s.design.nodes.map((n) => n.tech)).filter(Boolean))];
  return (
    <div className="flex items-center gap-1">
      {ids.slice(0, 7).map((id) => {
        const t = techOf(id);
        return t ? <TechLogo key={t.id} tech={t} className="size-4" tile={false} /> : null;
      })}
    </div>
  );
}

function CaseReader({ c, onBack, onOpen }: { c: CaseStudy; onBack: () => void; onOpen: (p: Project) => void }) {
  const [stage, setStage] = useState(0);
  const st = c.stages[stage];
  const copy = async () => {
    const p = projectFromPreset(
      { title: `${c.company}: ${st.title}`, description: `${c.title}. ${st.note}`, design: st.design, scenario: st.scenario },
      `${c.company} · ${st.title}`,
      `case:${c.id}`,
    );
    p.notes = [
      `Case study: ${c.title} (${c.company}, ${c.year})`,
      '',
      'Thử thách:',
      ...c.challenges.map((x) => `- ${x}`),
      '',
      'Nguồn:',
      ...c.sources.map((s) => `- ${s.title}: ${s.url}`),
    ].join('\n');
    await store.put(p);
    onOpen(p);
  };
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft /> Case study
        </Button>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{c.company}</span>· {c.year}
          {c.tags.map((t) => (
            <Badge key={t} variant="secondary" className="font-normal">
              {t}
            </Badge>
          ))}
        </div>
        <h2 className="text-xl font-semibold">{c.title}</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{c.summary}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-3">
          <div className="flex flex-wrap gap-1.5">
            {c.stages.map((s, i) => (
              <button
                key={s.title}
                onClick={() => setStage(i)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs transition-colors',
                  i === stage ? 'border-primary bg-primary/15' : 'text-muted-foreground hover:border-ring',
                )}
              >
                {s.title}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border bg-background/60">
            <Thumbnail design={st.design} className="aspect-[16/8] w-full p-3" />
          </div>
          <p className="text-sm leading-relaxed">{st.note}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={copy}>
              <FlaskConical /> Tạo bản sao để thử nghiệm
            </Button>
            <span className="text-xs text-muted-foreground">
              Mở giai đoạn này thành dự án của bạn, kèm thử thách trong tab Ghi chú. Bấm Chạy và bật “Traffic theo kịch bản”.
            </span>
          </div>
        </div>
        <div className="grid content-start gap-5">
          <section className="grid gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Bối cảnh</h3>
            <p className="text-sm leading-relaxed">{c.story}</p>
          </section>
          <section className="grid gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Quyết định và đánh đổi</h3>
            {c.decisions.map((d) => (
              <div key={d.title} className="rounded-md border p-2.5 text-sm">
                <div className="font-medium">{d.title}</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  <span className="text-success">Vì sao:</span> {d.why}
                </div>
                <div className="text-xs leading-relaxed text-muted-foreground">
                  <span className="text-warning">Đánh đổi:</span> {d.tradeoff}
                </div>
              </div>
            ))}
          </section>
          <section className="grid gap-2">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Thử thách</h3>
            <ul className="grid gap-1 text-sm">
              {c.challenges.map((x) => (
                <li key={x} className="flex gap-2">
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
                  {x}
                </li>
              ))}
            </ul>
          </section>
          <section className="grid gap-1.5">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Nguồn</h3>
            {c.sources.map((s) => (
              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                <ExternalLink className="size-3.5 shrink-0" /> {s.title}
              </a>
            ))}
          </section>
          <p className="flex gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3 shrink-0" /> {DISCLAIMER}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Case studies of large systems: read the story, then copy a stage to experiment. */
export function CaseLibrary({ cases, onOpen }: { cases: CaseStudy[]; onOpen: (p: Project) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = cases.find((c) => c.id === open);
  if (current) return <CaseReader c={current} onBack={() => setOpen(null)} onOpen={onOpen} />;
  return (
    <div className="grid gap-3">
      <p className="flex gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" /> {DISCLAIMER}
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {cases.map((c) => (
          <button
            key={c.id}
            onClick={() => setOpen(c.id)}
            className="group overflow-hidden rounded-lg border bg-card text-left transition-colors hover:border-ring"
          >
            <div className="bg-background/60">
              <Thumbnail design={c.stages[c.stages.length - 1].design} className="aspect-[16/8] w-full p-2" />
            </div>
            <div className="grid gap-1.5 border-t p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{c.company}</span> · {c.year} · {c.stages.length} giai đoạn
                <span className="ml-auto">
                  <Logos c={c} />
                </span>
              </div>
              <div className="text-sm leading-snug font-medium">{c.title}</div>
              <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{c.summary}</p>
              <div className="flex flex-wrap gap-1">
                {c.tags.map((t) => (
                  <Badge key={t} variant="outline" className="text-[10px] font-normal">
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

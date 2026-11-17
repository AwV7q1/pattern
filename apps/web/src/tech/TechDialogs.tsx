import { Check, GitCompareArrows, Minus, Plus, X } from 'lucide-react';
import { KIND_META, fmt } from '@/lib/meta';
import { DEFAULT_CONFIG } from '@/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TECH_BY_ID, TECHS } from './catalog';
import { ScoreBar, ScoreBars, ScoreLabel, SCORE_NOTE } from './ScoreBars';
import { TechLogo } from './TechLogo';
import { CATEGORIES, SCORE_KEYS, type Tech } from './types';
import { MAX_COMPARE, techUi, useTechUi } from './ui-store';

const categoryName = (t: Tech) => CATEGORIES.find((c) => c.id === t.category)?.name ?? t.category;

function List({ items, tone }: { items: string[]; tone?: 'good' | 'bad' }) {
  return (
    <ul className="grid gap-1 text-sm">
      {items.map((s) => (
        <li key={s} className="flex gap-2">
          {tone === 'good' ? (
            <Plus className="mt-0.5 size-3.5 shrink-0 text-success" />
          ) : tone === 'bad' ? (
            <Minus className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          ) : (
            <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
          )}
          <span className="leading-snug">{s}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</div>
      {children}
    </div>
  );
}

/** Simulation numbers in plain words. */
export function simSummary(t: Tech) {
  const c = { ...DEFAULT_CONFIG, ...t.config };
  const parts: string[] = [];
  if (c.instances > 1) parts.push(`${c.instances} instance`);
  if (c.model === 'cpu') parts.push(`${c.cpuLanes} CPU lane · CPU p50 ${fmt.ms(c.cpuP50Ms)} · ${c.maxInFlight} request mở`);
  else parts.push(`${c.concurrency} slot · p50 ${fmt.ms(c.latencyP50Ms)} / p99 ${fmt.ms(c.latencyP99Ms)}`);
  if (t.kind === 'cache') parts.push(`hit ${Math.round(c.hitRate * 100)}%`);
  if (c.gcPauseMs) parts.push(`GC ${c.gcPauseMs}ms`);
  parts.push(`${fmt.money(c.costPerHour)}/h`);
  return parts.join(' · ');
}

function TechSheet({ tech, inCompare }: { tech: Tech; inCompare: boolean }) {
  const alts = tech.alternatives.map((id) => TECH_BY_ID[id]).filter(Boolean);
  return (
    <>
      <DialogHeader className="flex-row items-center gap-3 space-y-0">
        <TechLogo tech={tech} className="size-11" />
        <div className="min-w-0 flex-1">
          <DialogTitle className="flex items-center gap-2">
            {tech.name}
            <Badge variant="secondary" className="font-normal">
              {tech.license}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {tech.vendor} · {categoryName(tech)} · mô phỏng như <b>{KIND_META[tech.kind].name}</b>
          </DialogDescription>
        </div>
      </DialogHeader>
      <Tabs defaultValue="overview" className="min-h-0">
        <TabsList>
          <TabsTrigger value="overview">Tổng quan</TabsTrigger>
          <TabsTrigger value="details">Chi tiết</TabsTrigger>
          <TabsTrigger value="deploy">Cấu hình</TabsTrigger>
        </TabsList>
        <ScrollArea className="mt-3 max-h-[58vh] pr-3">
          <TabsContent value="overview" className="grid gap-5">
            <p className="text-sm leading-relaxed">{tech.summary}</p>
            <ScoreBars tech={tech} />
            <p className="text-[11px] text-muted-foreground">{SCORE_NOTE}</p>
            <div className="grid grid-cols-2 gap-4">
              <Section title="Điểm mạnh">
                <List items={tech.details.strengths} tone="good" />
              </Section>
              <Section title="Điểm yếu">
                <List items={tech.details.weaknesses} tone="bad" />
              </Section>
            </div>
          </TabsContent>
          <TabsContent value="details" className="grid gap-5">
            <div className="grid grid-cols-2 gap-4">
              <Section title="Nên dùng khi">
                <List items={tech.details.useWhen} tone="good" />
              </Section>
              <Section title="Tránh khi">
                <List items={tech.details.avoidWhen} tone="bad" />
              </Section>
            </div>
            {tech.details.semantics && (
              <Section title="Ngữ nghĩa cần nhớ">
                <List items={tech.details.semantics} />
              </Section>
            )}
            {alts.length > 0 && (
              <Section title="Lựa chọn thay thế">
                <div className="flex flex-wrap gap-2">
                  {alts.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => techUi.openSheet(a.id)}
                      className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:border-ring"
                    >
                      <TechLogo tech={a} className="size-4" tile={false} />
                      {a.name}
                    </button>
                  ))}
                </div>
              </Section>
            )}
          </TabsContent>
          <TabsContent value="deploy" className="grid gap-5">
            <Section title="Số liệu mô phỏng mặc định">
              <p className="font-mono text-xs">{simSummary(tech)}</p>
              {tech.edgeDefaults?.poolSize && (
                <p className="text-xs text-muted-foreground">
                  Edge mới trỏ vào đây có pool {tech.edgeDefaults.poolSize} connection mỗi process gọi.
                </p>
              )}
            </Section>
            <Section title="Thiết lập quan trọng khi triển khai">
              <List items={tech.deploy.keySettings} />
              {tech.deploy.image && <p className="font-mono text-xs text-muted-foreground">image: {tech.deploy.image}</p>}
            </Section>
          </TabsContent>
        </ScrollArea>
      </Tabs>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => techUi.toggleCompare(tech.id)}>
          {inCompare ? <Check /> : <Plus />} {inCompare ? 'Đã thêm vào so sánh' : 'Thêm vào so sánh'}
        </Button>
        <Button size="sm" onClick={() => techUi.compareWith([tech.id, ...tech.alternatives.slice(0, 2)])}>
          <GitCompareArrows /> So sánh với lựa chọn thay thế
        </Button>
      </div>
    </>
  );
}

function CompareView({ ids }: { ids: string[] }) {
  const techs = ids.map((id) => TECH_BY_ID[id]).filter(Boolean);
  const kind = techs[0]?.kind;
  const suggestions = TECHS.filter((t) => t.kind === kind && !ids.includes(t.id)).slice(0, 8);
  const cols = { gridTemplateColumns: `130px repeat(${Math.max(techs.length, 1)}, minmax(0, 1fr))` };
  const total = (t: Tech) => SCORE_KEYS.reduce((s, k) => s + t.scores[k], 0);
  return (
    <>
      <DialogHeader>
        <DialogTitle>So sánh công nghệ</DialogTitle>
        <DialogDescription>Tối đa {MAX_COMPARE} lựa chọn. {SCORE_NOTE}</DialogDescription>
      </DialogHeader>
      {techs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Chưa chọn công nghệ nào. Bấm “+” trên thẻ trong thư viện để thêm.</p>
      ) : (
        <ScrollArea className="max-h-[66vh] pr-3">
          <div className="grid gap-x-4 gap-y-2" style={cols}>
            <div />
            {techs.map((t) => (
              <div key={t.id} className="flex items-center gap-2 border-b pb-2">
                <TechLogo tech={t} className="size-8" />
                <button className="min-w-0 flex-1 text-left" onClick={() => techUi.openSheet(t.id)}>
                  <div className="truncate text-sm font-semibold hover:underline">{t.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{categoryName(t)}</div>
                </button>
                <Button size="icon-sm" variant="ghost" aria-label="Bỏ" onClick={() => techUi.toggleCompare(t.id)}>
                  <X />
                </Button>
              </div>
            ))}
            {SCORE_KEYS.map((k) => {
              const best = Math.max(...techs.map((t) => t.scores[k]));
              return (
                <div key={k} className="contents">
                  <ScoreLabel k={k} />
                  {techs.map((t) => (
                    <ScoreBar key={t.id} value={t.scores[k]} best={techs.length > 1 && t.scores[k] === best} compact />
                  ))}
                </div>
              );
            })}
            <span className="text-xs text-muted-foreground">Tổng điểm</span>
            {techs.map((t) => (
              <span key={t.id} className="font-mono text-xs">
                {total(t)} / 70
              </span>
            ))}
            <span className="pt-3 text-xs text-muted-foreground">Tóm tắt</span>
            {techs.map((t) => (
              <p key={t.id} className="pt-3 text-xs leading-relaxed">
                {t.summary}
              </p>
            ))}
            <span className="text-xs text-muted-foreground">Điểm mạnh</span>
            {techs.map((t) => (
              <div key={t.id} className="text-xs">
                <List items={t.details.strengths} tone="good" />
              </div>
            ))}
            <span className="text-xs text-muted-foreground">Điểm yếu</span>
            {techs.map((t) => (
              <div key={t.id} className="text-xs">
                <List items={t.details.weaknesses} tone="bad" />
              </div>
            ))}
            <span className="text-xs text-muted-foreground">Nên dùng khi</span>
            {techs.map((t) => (
              <div key={t.id} className="text-xs">
                <List items={t.details.useWhen} />
              </div>
            ))}
            <span className="text-xs text-muted-foreground">Mô phỏng</span>
            {techs.map((t) => (
              <p key={t.id} className={cn('font-mono text-[11px] text-muted-foreground')}>
                {simSummary(t)}
              </p>
            ))}
          </div>
        </ScrollArea>
      )}
      {techs.length < MAX_COMPARE && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
          <span className="mr-1 text-xs text-muted-foreground">Thêm:</span>
          {suggestions.map((t) => (
            <button
              key={t.id}
              onClick={() => techUi.toggleCompare(t.id)}
              className="flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs hover:border-ring"
            >
              <TechLogo tech={t} className="size-4" tile={false} />
              {t.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Mounted once: tech detail sheet and comparison dialog. */
export function TechDialogs() {
  const ui = useTechUi();
  const tech = ui.sheet ? TECH_BY_ID[ui.sheet] : undefined;
  return (
    <>
      <Dialog open={!!tech} onOpenChange={(o) => !o && techUi.closeSheet()}>
        <DialogContent className="sm:max-w-2xl">
          {tech && <TechSheet tech={tech} inCompare={ui.compare.includes(tech.id)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={ui.compareOpen} onOpenChange={(o) => !o && techUi.closeCompare()}>
        <DialogContent className="sm:max-w-5xl">
          <CompareView ids={ui.compare} />
        </DialogContent>
      </Dialog>
    </>
  );
}

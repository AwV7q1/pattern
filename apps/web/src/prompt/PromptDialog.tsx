import { useMemo, useState } from 'react';
import { Check, Copy, Download, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { download, slug, type Project } from '@/projects/store';
import { buildPrompt, TARGET_LABELS, type PromptTarget } from './buildPrompt';

interface Props {
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Turn the open design into a brief for a coding agent: preview, copy, download. */
export function PromptDialog({ project, open, onOpenChange }: Props) {
  const [targets, setTargets] = useState<PromptTarget[]>(['compose', 'nestjs']);
  const [includeRun, setIncludeRun] = useState(true);
  const [includeMermaid, setIncludeMermaid] = useState(true);
  const [copied, setCopied] = useState(false);
  const text = useMemo(
    () => (project && open ? buildPrompt(project, { targets, includeRun, includeMermaid }) : ''),
    [project, open, targets, includeRun, includeMermaid],
  );
  const toggle = (t: PromptTarget) => setTargets((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" /> Prompt cho agent triển khai
          </DialogTitle>
          <DialogDescription>
            Tổng hợp kiến trúc, công nghệ, chính sách timeout/retry/pool, SLO, kịch bản sự cố và kết quả mô phỏng thành một
            yêu cầu markdown. Dán vào Claude Code hoặc agent bất kỳ.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Bàn giao:</span>
            {(Object.keys(TARGET_LABELS) as PromptTarget[]).map((t) => (
              <button
                key={t}
                onClick={() => toggle(t)}
                className={cn(
                  'flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors',
                  targets.includes(t) ? 'border-primary bg-primary/15 text-foreground' : 'text-muted-foreground hover:border-ring',
                )}
              >
                {targets.includes(t) && <Check className="size-3" />}
                {TARGET_LABELS[t]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Switch id="p-run" checked={includeRun} onCheckedChange={setIncludeRun} disabled={!project?.lastRun} />
            <Label htmlFor="p-run" className="text-xs">
              Kèm kết quả mô phỏng{!project?.lastRun && ' (hãy chạy mô phỏng trước)'}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="p-mm" checked={includeMermaid} onCheckedChange={setIncludeMermaid} />
            <Label htmlFor="p-mm" className="text-xs">
              Sơ đồ Mermaid
            </Label>
          </div>
        </div>
        <pre className="max-h-[56vh] overflow-auto rounded-md border bg-background/60 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
          {text}
        </pre>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {text.length.toLocaleString('en')} ký tự · ~{Math.round(text.length / 3.5).toLocaleString('en')} token
          </span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={() => project && download(`${slug(project.name)}-prompt.md`, text, 'text/markdown')}
          >
            <Download /> Tải .md
          </Button>
          <Button size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />} {copied ? 'Đã copy' : 'Copy prompt'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

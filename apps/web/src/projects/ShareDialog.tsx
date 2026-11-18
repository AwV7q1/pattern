import { useEffect, useState } from 'react';
import { Check, Copy, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { shareProject, type Project } from './store';

interface Props {
  /** Snapshot to publish; read once when the dialog opens. */
  project: Project | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type State = { status: 'loading' } | { status: 'done'; url: string } | { status: 'error'; message: string };

/** Publish a read-only snapshot and show its link. Every open creates a new link. */
export function ShareDialog({ project, open, onOpenChange }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !project) return;
    let alive = true;
    setState({ status: 'loading' });
    setCopied(false);
    shareProject(project).then(
      (url) => alive && setState({ status: 'done', url }),
      (e: Error) => alive && setState({ status: 'error', message: e.message }),
    );
    return () => {
      alive = false;
    };
    // a snapshot of the moment the dialog opened, not of later edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const copy = async (url: string) => {
    await navigator.clipboard?.writeText(url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4" /> Chia sẻ bản thiết kế
          </DialogTitle>
          <DialogDescription>
            Link chứa bản chụp design, kịch bản và ghi chú tại thời điểm này. Người mở nhận một bản sao riêng; thay đổi sau đó của bạn không cập nhật vào link.
          </DialogDescription>
        </DialogHeader>
        {state.status === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Đang tạo link…
          </div>
        )}
        {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
        {state.status === 'done' && (
          <div className="flex gap-2">
            <Input readOnly value={state.url} aria-label="Link chia sẻ" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button onClick={() => copy(state.url)}>
              {copied ? <Check /> : <Copy />} {copied ? 'Đã chép' : 'Chép'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

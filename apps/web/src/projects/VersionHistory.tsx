import { useEffect, useState } from 'react';
import { Bookmark, Check, History, Pencil, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { store, timeAgo, type Version } from './store';
import { Thumbnail } from './Thumbnail';

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (v: Version) => void;
  onSaveNamed: () => void;
  /** Bumped by the parent when a version is added, to reload the list. */
  revision: number;
}

/** Version list: named (⌘S) and automatic snapshots, restore is non-destructive. */
export function VersionHistory({ projectId, open, onOpenChange, onRestore, onSaveNamed, revision }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [onlyNamed, setOnlyNamed] = useState(false);

  useEffect(() => {
    if (!open) return;
    store.versions(projectId).then((vs) => {
      setVersions(vs);
      setSelected((s) => s ?? vs[0]?.id ?? null);
    });
  }, [open, projectId, revision]);

  const shown = onlyNamed ? versions.filter((v) => !v.auto) : versions;
  const current = versions.find((v) => v.id === selected);

  const rename = async (v: Version) => {
    const next = { ...v, label: label.trim() || undefined, auto: !label.trim() };
    await store.updateVersion(next);
    setVersions((vs) => vs.map((x) => (x.id === v.id ? next : x)));
    setEditing(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4" /> Lịch sử phiên bản
          </DialogTitle>
          <DialogDescription>
            Tự chụp lại mỗi 5 phút khi có chỉnh sửa (giữ 50 bản gần nhất). Phiên bản có tên được giữ vĩnh viễn. Khôi phục
            không làm mất bản hiện tại.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_1.3fr] gap-4">
          <div className="grid min-h-0 gap-2">
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={onSaveNamed}>
                <Bookmark /> Lưu phiên bản
              </Button>
              <button
                className={cn('ml-auto text-xs text-muted-foreground hover:text-foreground', onlyNamed && 'text-primary')}
                onClick={() => setOnlyNamed((v) => !v)}
              >
                {onlyNamed ? 'Hiện tất cả' : 'Chỉ bản có tên'}
              </button>
            </div>
            <ScrollArea className="h-[52vh] rounded-md border">
              {shown.length === 0 && <p className="p-3 text-xs text-muted-foreground">Chưa có phiên bản nào.</p>}
              {shown.map((v) => (
                <div
                  key={v.id}
                  onClick={() => setSelected(v.id)}
                  className={cn(
                    'group flex cursor-pointer items-center gap-2 border-b px-3 py-2 text-sm last:border-0',
                    selected === v.id ? 'bg-accent' : 'hover:bg-accent/50',
                  )}
                >
                  {v.auto ? <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/50" /> : <Bookmark className="size-3.5 shrink-0 text-primary" />}
                  <div className="min-w-0 flex-1">
                    {editing === v.id ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          rename(v);
                        }}
                        className="flex gap-1"
                      >
                        <Input autoFocus className="h-7 text-xs" value={label} onChange={(e) => setLabel(e.target.value)} />
                        <Button type="submit" size="icon-sm" variant="ghost">
                          <Check />
                        </Button>
                      </form>
                    ) : (
                      <>
                        <div className={cn('truncate', v.auto && 'text-muted-foreground')}>{v.label ?? 'Tự động lưu'}</div>
                        <div className="text-[11px] text-muted-foreground" title={new Date(v.at).toLocaleString('vi-VN')}>
                          {timeAgo(v.at)} · {v.design.nodes.length} node
                        </div>
                      </>
                    )}
                  </div>
                  {editing !== v.id && (
                    <button
                      className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
                      aria-label="Đặt tên"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(v.id);
                        setLabel(v.label ?? '');
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </ScrollArea>
          </div>
          <div className="grid content-start gap-3">
            {current ? (
              <>
                <Thumbnail design={current.design} className="aspect-[4/3] w-full rounded-md border bg-background" />
                <div className="text-sm">
                  <div className="font-medium">{current.label ?? 'Tự động lưu'}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(current.at).toLocaleString('vi-VN')} · {current.design.nodes.length} node ·{' '}
                    {current.design.edges.length} edge
                  </div>
                </div>
                <Button
                  onClick={() => {
                    onRestore(current);
                    onOpenChange(false);
                  }}
                >
                  <RotateCcw /> Khôi phục phiên bản này
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Chọn một phiên bản để xem trước.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

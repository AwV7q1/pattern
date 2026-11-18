import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Camera, Check, Copy, Link2, Loader2, Radio, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/app/api';
import { useAuth } from '@/app/auth-store';
import { idb, idbStore, type Project } from '@/projects/store';
import { syncNow } from '@/projects/sync';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ShareRow {
  slug: string;
  mode: 'live' | 'snapshot';
  createdAt: string;
  views: number;
}

const urlOf = (slug: string) => `${location.origin}/s/${slug}`;

/** Read-only links to a project: live (follows edits) or a frozen snapshot. */
export function ShareDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
  const auth = useAuth();
  const [owned, setOwned] = useState<boolean | null>(null);
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const local = await idbStore.get(project.id);
    const isOwned = !!local?.owner;
    setOwned(isOwned);
    if (!isOwned) return;
    try {
      setRows(await api<ShareRow[]>(`/projects/${project.id}/shares`));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'Dự án chưa lên server, đang đồng bộ…' : String((e as Error).message));
    }
  }, [project.id]);

  useEffect(() => {
    if (open && auth.status === 'signed-in') void load();
  }, [open, auth.status, load]);

  const upload = async () => {
    setBusy(true);
    await idb.enqueue({ key: `project:${project.id}`, kind: 'project', id: project.id, at: Date.now() });
    await syncNow();
    await load();
    setBusy(false);
  };

  const create = async (mode: 'live' | 'snapshot') => {
    setBusy(true);
    setError(null);
    try {
      await syncNow(); // the link shows what the server has
      const row = await api<ShareRow>(`/projects/${project.id}/shares`, { body: { mode } });
      await navigator.clipboard?.writeText(urlOf(row.slug)).catch(() => {});
      setCopied(row.slug);
      await load();
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="size-4" /> Chia sẻ “{project.name}”
          </DialogTitle>
          <DialogDescription>
            Người có link xem được canvas và chạy mô phỏng, không cần tài khoản, không sửa được bản của bạn.
          </DialogDescription>
        </DialogHeader>
        {auth.status !== 'signed-in' ? (
          <p className="text-sm">
            <Link to={`/login?next=${encodeURIComponent(location.pathname)}`} className="text-primary underline">
              Đăng nhập
            </Link>{' '}
            để tạo link chia sẻ (cần server).
          </p>
        ) : owned === false ? (
          <div className="grid gap-2 text-sm">
            <p>Dự án này mới chỉ lưu trên máy. Đẩy lên tài khoản để tạo link.</p>
            <Button className="justify-self-start" disabled={busy} onClick={() => void upload()}>
              {busy && <Loader2 className="animate-spin" />} Đẩy lên tài khoản
            </Button>
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void create('live')} className="h-auto flex-col items-start gap-0.5 py-2 text-left">
                <span className="flex items-center gap-1.5 font-medium">
                  <Radio className="size-4" /> Link trực tiếp
                </span>
                <span className="text-xs font-normal whitespace-normal text-muted-foreground">Luôn hiện bản mới nhất bạn lưu</span>
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => void create('snapshot')} className="h-auto flex-col items-start gap-0.5 py-2 text-left">
                <span className="flex items-center gap-1.5 font-medium">
                  <Camera className="size-4" /> Ảnh chụp
                </span>
                <span className="text-xs font-normal whitespace-normal text-muted-foreground">Đóng băng bản hiện tại, sửa sau không đổi</span>
              </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {rows.map((r) => (
              <div key={r.slug} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
                {r.mode === 'live' ? <Radio className="size-4 text-success" /> : <Camera className="size-4 text-muted-foreground" />}
                <code className="min-w-0 flex-1 truncate text-xs">{urlOf(r.slug)}</code>
                <span className="text-xs text-muted-foreground">{r.views} lượt xem</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Sao chép link"
                  onClick={() => {
                    void navigator.clipboard?.writeText(urlOf(r.slug));
                    setCopied(r.slug);
                  }}
                >
                  {copied === r.slug ? <Check /> : <Copy />}
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-destructive"
                  aria-label="Thu hồi link"
                  onClick={async () => {
                    await api(`/shares/${r.slug}`, { method: 'DELETE' });
                    await load();
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

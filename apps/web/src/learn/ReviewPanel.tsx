import { Brain, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PopoutPanel } from '@/components/PopoutPanel';
import { cn } from '@/lib/utils';
import { cardByKey, cardPrompt } from './curriculum';
import { LEARNED, REVIEW_SIZE, addDays, dueKeys, today, weakKeys, type Progress } from './progress';

const TYPE_LABEL: Record<string, string> = { choice: 'Trắc nghiệm', order: 'Sắp xếp', predict: 'Dự đoán', fix: 'Sửa design' };

function dueText(due: string | null, day: string) {
  if (due === null) return 'đã thuộc';
  if (due <= day) return due < day ? 'quá hạn' : 'hôm nay';
  if (due === addDays(day, 1)) return 'ngày mai';
  const [, m, d] = due.split('-');
  return `${d}/${m}`;
}

/** 0..LEARNED filled dots: how well a card is remembered. */
function Strength({ box }: { box: number }) {
  return (
    <span className="inline-flex gap-0.5" title={box >= LEARNED ? 'đã thuộc' : `hộp ${box + 1}/${LEARNED}`}>
      {Array.from({ length: LEARNED }, (_, i) => (
        <i key={i} className={cn('size-1.5 rounded-full', i < box ? 'bg-emerald-400' : i === box && box < LEARNED ? 'bg-warning' : 'bg-muted')} />
      ))}
    </span>
  );
}

interface Props {
  progress: Progress;
  /** Start a review session with these card keys. */
  onStart: (keys: string[]) => void;
}

/**
 * Spaced repetition: questions answered wrong come back after 1, 3, 7 and 21
 * days. Docked it shows what is due; popped out it lists the whole deck.
 */
export function ReviewPanel({ progress, onStart }: Props) {
  const day = today();
  const entries = Object.entries(progress.review)
    .map(([key, r]) => ({ key, r, ref: cardByKey(key) }))
    .filter((e) => e.ref);
  const due = dueKeys(progress, day).filter((k) => cardByKey(k));
  const weak = weakKeys(progress).filter((k) => cardByKey(k));
  const learned = entries.filter((e) => e.r.due === null).length;
  const upcoming = entries
    .filter((e) => e.r.due !== null && e.r.due > day)
    .sort((a, b) => a.r.due!.localeCompare(b.r.due!))[0];

  return (
    <PopoutPanel icon={<Brain />} title="Ôn tập" className="border-2">
      {(wide) => (
        <div className="grid gap-3">
          {entries.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Câu nào trả lời sai sẽ được đưa vào đây và hỏi lại sau <b>1, 3, 7, 21 ngày</b>. Trả lời đúng liền 4 lần là thuộc.
            </p>
          ) : (
            <>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className={cn('text-3xl font-bold', due.length ? 'text-warning' : 'text-muted-foreground')}>{due.length}</div>
                  <div className="text-xs text-muted-foreground">câu đến hạn hôm nay</div>
                </div>
                <div className="text-right text-[11px] text-muted-foreground">
                  <div>
                    {entries.length - learned} đang học · {learned} đã thuộc
                  </div>
                  {!due.length && upcoming && <div>lần tới: {dueText(upcoming.r.due, day)}</div>}
                </div>
              </div>
              {due.length > 0 ? (
                <Button onClick={() => onStart(due)}>
                  <Play /> Ôn ngay ({Math.min(due.length, REVIEW_SIZE)} câu)
                </Button>
              ) : (
                weak.length > 0 && (
                  <Button variant="outline" onClick={() => onStart(weak)}>
                    Ôn sớm các câu yếu nhất
                  </Button>
                )
              )}
              {wide ? (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="py-1.5 pr-3 font-normal">Câu hỏi</th>
                      <th className="pr-3 font-normal">Bài</th>
                      <th className="pr-3 font-normal">Loại</th>
                      <th className="pr-3 font-normal">Độ nhớ</th>
                      <th className="pr-3 text-right font-normal">Sai</th>
                      <th className="pr-3 font-normal">Ôn lần tới</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {entries
                      .sort((a, b) => (a.r.due ?? '9').localeCompare(b.r.due ?? '9') || a.r.box - b.r.box)
                      .map(({ key, r, ref }) => (
                        <tr key={key} className="border-b border-border/50">
                          <td className="max-w-md py-1.5 pr-3">
                            <div className="truncate" title={cardPrompt(ref!.card)}>
                              {cardPrompt(ref!.card)}
                            </div>
                          </td>
                          <td className="pr-3 text-xs whitespace-nowrap" style={{ color: ref!.lesson.unit.color }}>
                            {ref!.lesson.title}
                          </td>
                          <td className="pr-3 text-xs whitespace-nowrap text-muted-foreground">{TYPE_LABEL[ref!.card.type]}</td>
                          <td className="pr-3">
                            <Strength box={r.box} />
                          </td>
                          <td className="pr-3 text-right font-mono text-xs">{r.misses}</td>
                          <td className={cn('pr-3 text-xs whitespace-nowrap', r.due !== null && r.due <= day && 'font-semibold text-warning')}>
                            {dueText(r.due, day)}
                          </td>
                          <td className="text-right">
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onStart([key])}>
                              Ôn câu này
                            </Button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <div className="grid gap-1">
                  {entries
                    .filter((e) => e.r.due !== null)
                    .sort((a, b) => a.r.due!.localeCompare(b.r.due!))
                    .slice(0, 4)
                    .map(({ key, r, ref }) => (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        <Strength box={r.box} />
                        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={cardPrompt(ref!.card)}>
                          {cardPrompt(ref!.card)}
                        </span>
                        <span className={cn('whitespace-nowrap', r.due! <= day && 'text-warning')}>{dueText(r.due, day)}</span>
                      </div>
                    ))}
                  {entries.length > 4 && <p className="text-[11px] text-muted-foreground">Tách ra để xem cả {entries.length} câu.</p>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </PopoutPanel>
  );
}

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatReportDate } from "@/lib/daily-report-format";
import { trpc } from "@/lib/trpc";
import { KOSOVO_MOVABLE_HOLIDAYS, todayReportDate } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createRoute } from "@tanstack/react-router";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const holidaysRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/holidays",
  component: HolidaysPage,
});

type FormState = {
  holidayId?: string;
  name: string;
  date: string;
  isRecurringFixed: boolean;
  observedDate: string;
};

const EMPTY_FORM: FormState = { name: "", date: "", isRecurringFixed: false, observedDate: "" };

// M7.4 public holiday calendar: everyone reads it; HR (holiday:manage) keeps it.
function HolidaysPage() {
  const { workspaceId } = holidaysRoute.useParams();
  const [year, setYear] = useState(() => Number(todayReportDate(new Date()).slice(0, 4)));
  const utils = trpc.useUtils();
  const calendar = trpc.holiday.list.useQuery({ workspaceId, year });
  const invalidate = () => utils.holiday.list.invalidate({ workspaceId });
  const [form, setForm] = useState<FormState | null>(null);

  const create = trpc.holiday.create.useMutation({
    onSuccess: () => (setForm(null), invalidate()),
  });
  const update = trpc.holiday.update.useMutation({
    onSuccess: () => (setForm(null), invalidate()),
  });
  const remove = trpc.holiday.delete.useMutation({ onSuccess: invalidate });
  const setNoticeDays = trpc.holiday.setNoticeDays.useMutation({ onSuccess: invalidate });

  const data = calendar.data;
  const holidays = data?.holidays ?? [];
  const canManage = data?.canManage ?? false;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: holidays.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || !form.name.trim() || !form.date) return;
    const observedDate = form.isRecurringFixed ? null : form.observedDate || null;
    if (form.holidayId) {
      update.mutate({
        holidayId: form.holidayId,
        name: form.name.trim(),
        date: form.date,
        isRecurringFixed: form.isRecurringFixed,
        observedDate,
      });
    } else {
      create.mutate({
        workspaceId,
        name: form.name.trim(),
        date: form.date,
        isRecurringFixed: form.isRecurringFixed,
        observedDate,
      });
    }
  }

  const missingMovable = KOSOVO_MOVABLE_HOLIDAYS.filter(
    (m) => !holidays.some((h) => !h.isRecurringFixed && h.name === m.name),
  );
  const mutationError = create.error ?? update.error ?? remove.error ?? setNoticeDays.error;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6" data-testid="holidays-page">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <CalendarDays className="h-5 w-5" aria-hidden />
        </span>
        <div className="mr-auto">
          <h1 className="text-lg font-semibold">Public holidays</h1>
          <p className="text-muted-foreground text-xs">
            Kosovo calendar. A holiday on a weekend is taken on the next working day.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous year"
            onClick={() => setYear(year - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-sm font-semibold" data-testid="holidays-year">
            {year}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next year"
            onClick={() => setYear(year + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {data && !data.hasMovableHolidays && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          role="status"
          data-testid="holidays-missing-movable"
        >
          <p className="font-medium">No movable holidays entered for {year}.</p>
          <p className="text-muted-foreground text-xs">
            Easter Mondays and the two Eids change every year
            {canManage ? " — add them below." : " — HR adds them."}
          </p>
        </div>
      )}

      {canManage && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setForm({ ...EMPTY_FORM })} data-testid="holiday-add">
              Add holiday
            </Button>
            {missingMovable.map((m) => (
              <Button
                key={m.name}
                size="sm"
                variant="outline"
                onClick={() =>
                  setForm({ ...EMPTY_FORM, name: m.name, date: m.suggestDate?.(year) ?? "" })
                }
              >
                + {m.name}
              </Button>
            ))}
            <label className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
              Notify everyone
              <Input
                type="number"
                min={0}
                max={30}
                aria-label="Notice days"
                key={data?.noticeDays}
                defaultValue={data?.noticeDays ?? 2}
                onBlur={(e) => {
                  const days = Number(e.target.value);
                  if (
                    Number.isInteger(days) &&
                    days >= 0 &&
                    days <= 30 &&
                    days !== data?.noticeDays
                  ) {
                    setNoticeDays.mutate({ workspaceId, days });
                  }
                }}
                className="h-8 w-16 text-sm"
              />
              days before (0 = off)
            </label>
          </div>

          {form && (
            <form
              onSubmit={submit}
              className="border-border grid grid-cols-2 gap-3 rounded-md border p-3"
              data-testid="holiday-form"
            >
              <div className="col-span-2 space-y-1">
                <Label htmlFor="holiday-name" className="text-xs">
                  Name
                </Label>
                <Input
                  id="holiday-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="holiday-date" className="text-xs">
                  Date
                </Label>
                <Input
                  id="holiday-date"
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              {!form.isRecurringFixed && (
                <div className="space-y-1">
                  <Label htmlFor="holiday-observed" className="text-xs">
                    Day off (if different)
                  </Label>
                  <Input
                    id="holiday-observed"
                    type="date"
                    value={form.observedDate}
                    onChange={(e) => setForm({ ...form, observedDate: e.target.value })}
                  />
                </div>
              )}
              <label className="col-span-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isRecurringFixed}
                  onChange={(e) => setForm({ ...form, isRecurringFixed: e.target.checked })}
                />
                Same date every year
              </label>
              <div className="col-span-2 flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={create.isPending || update.isPending}
                  data-testid="holiday-save"
                >
                  {form.holidayId ? "Save" : "Add"}
                </Button>
              </div>
            </form>
          )}
          {mutationError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {mutationError.message}
            </p>
          )}
        </div>
      )}

      {calendar.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : holidays.length === 0 ? (
        <p className="text-muted-foreground text-sm">No holidays in {year}.</p>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="holidays-list">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const h = holidays[item.index]!;
              const moved = h.observedDate !== h.date;
              return (
                <div
                  key={`${h.id}-${h.date}`}
                  className="absolute right-0 left-0 pb-1.5"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <div
                    className="border-border group flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                    data-testid={`holiday-${h.name}`}
                  >
                    <span className="w-36 shrink-0 tabular-nums">{formatReportDate(h.date)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{h.name}</span>
                      {moved && (
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          Day off {formatReportDate(h.observedDate)}
                        </span>
                      )}
                    </span>
                    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px]">
                      {h.isRecurringFixed ? "Every year" : `${year} only`}
                    </span>
                    {canManage && (
                      <span className="hidden gap-2 text-xs group-hover:flex">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setForm({
                              holidayId: h.id,
                              name: h.name,
                              date: h.date,
                              isRecurringFixed: h.isRecurringFixed,
                              observedDate: h.observedOverride ?? "",
                            })
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${h.name}`}
                          className="text-muted-foreground hover:text-red-600"
                          onClick={() => remove.mutate({ holidayId: h.id })}
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

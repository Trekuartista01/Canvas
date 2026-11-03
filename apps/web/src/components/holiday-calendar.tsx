import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatReportDate } from "@/lib/daily-report-format";
import { trpc } from "@/lib/trpc";
import { todayReportDate } from "@canvas/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";

type FormState = {
  holidayId?: string;
  date: string;
  nameSq: string;
  nameEn: string;
  isObservedSubstitute: boolean;
};

const EMPTY_FORM: FormState = { date: "", nameSq: "", nameEn: "", isObservedSubstitute: false };

/**
 * P8.2 official holidays for one year. Every row is one non-working day.
 * `manage` (Leave approvals → Official holidays, HR only) adds the edit
 * controls; the server still checks holiday:manage on every change.
 */
export function HolidayCalendar({ workspaceId, manage }: { workspaceId: string; manage: boolean }) {
  const [year, setYear] = useState(() => Number(todayReportDate(new Date()).slice(0, 4)));
  const utils = trpc.useUtils();
  const calendar = trpc.holiday.list.useQuery({ workspaceId, year });
  const invalidate = () => {
    void utils.holiday.list.invalidate({ workspaceId });
    void utils.holiday.reminder.invalidate({ workspaceId });
  };
  const [form, setForm] = useState<FormState | null>(null);

  const create = trpc.holiday.create.useMutation({
    onSuccess: () => (setForm(null), invalidate()),
  });
  const update = trpc.holiday.update.useMutation({
    onSuccess: () => (setForm(null), invalidate()),
  });
  const remove = trpc.holiday.delete.useMutation({ onSuccess: invalidate });
  const setNoticeDays = trpc.holiday.setNoticeDays.useMutation({ onSuccess: invalidate });
  const setSubstitution = trpc.holiday.setWeekendSubstitution.useMutation({
    onSuccess: invalidate,
  });

  const data = calendar.data;
  const holidays = data?.holidays ?? [];
  const canManage = manage && (data?.canManage ?? false);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: holidays.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form || !form.nameSq.trim() || !form.nameEn.trim() || !form.date) return;
    const fields = {
      date: form.date,
      nameSq: form.nameSq.trim(),
      nameEn: form.nameEn.trim(),
      isObservedSubstitute: form.isObservedSubstitute,
    };
    if (form.holidayId) update.mutate({ holidayId: form.holidayId, ...fields });
    else create.mutate({ workspaceId, ...fields });
  }

  const mutationError =
    create.error ?? update.error ?? remove.error ?? setNoticeDays.error ?? setSubstitution.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="holiday-calendar">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-muted-foreground mr-auto text-xs">
          Kosovo calendar. Each row is a day off; working days are Monday to Friday minus these.
        </p>
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

      {canManage && data && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => setForm({ ...EMPTY_FORM })} data-testid="holiday-add">
              Add holiday
            </Button>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={data.weekendSubstitution}
                disabled={setSubstitution.isPending}
                onChange={(e) => setSubstitution.mutate({ workspaceId, enabled: e.target.checked })}
                data-testid="holiday-substitution"
              />
              Weekend holiday → Monday off
            </label>
            <label className="text-muted-foreground ml-auto flex items-center gap-2 text-xs">
              Notify everyone
              <Input
                type="number"
                min={0}
                max={30}
                aria-label="Notice days"
                key={data.noticeDays}
                defaultValue={data.noticeDays}
                onBlur={(e) => {
                  const days = Number(e.target.value);
                  if (
                    Number.isInteger(days) &&
                    days >= 0 &&
                    days <= 30 &&
                    days !== data.noticeDays
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
              <div className="space-y-1">
                <Label htmlFor="holiday-name-sq" className="text-xs">
                  Emri (shqip)
                </Label>
                <Input
                  id="holiday-name-sq"
                  required
                  value={form.nameSq}
                  onChange={(e) => setForm({ ...form, nameSq: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="holiday-name-en" className="text-xs">
                  Name (English)
                </Label>
                <Input
                  id="holiday-name-en"
                  required
                  value={form.nameEn}
                  onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
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
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isObservedSubstitute}
                  onChange={(e) => setForm({ ...form, isObservedSubstitute: e.target.checked })}
                />
                Substitute day (for a holiday on a weekend)
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
        <p className="text-muted-foreground text-sm" data-testid="holidays-empty">
          No official holidays in {year}.
        </p>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto" data-testid="holidays-list">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((item) => {
              const h = holidays[item.index]!;
              return (
                <div
                  key={h.id}
                  className="absolute right-0 left-0 pb-1.5"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  <div
                    className="border-border group flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                    data-testid={`holiday-${h.date}`}
                  >
                    <span className="w-36 shrink-0 tabular-nums">{formatReportDate(h.date)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{h.nameSq}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {h.nameEn}
                      </span>
                    </span>
                    {h.isObservedSubstitute && (
                      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px]">
                        Substitute
                      </span>
                    )}
                    {h.onWeekend && (
                      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px]">
                        Weekend
                      </span>
                    )}
                    {h.needsConfirmation && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                        Confirm date
                      </span>
                    )}
                    {canManage && (
                      <span className="hidden gap-2 text-xs group-focus-within:flex group-hover:flex">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setForm({
                              holidayId: h.id,
                              date: h.date,
                              nameSq: h.nameSq,
                              nameEn: h.nameEn,
                              isObservedSubstitute: h.isObservedSubstitute,
                            })
                          }
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${h.nameEn}`}
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

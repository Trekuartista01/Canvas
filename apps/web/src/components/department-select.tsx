import { DEPARTMENTS } from "@canvas/shared";

/** A saved department that's no longer on the list stays selectable, so saving doesn't lose it. */
export function DepartmentSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const isOnList = !value || (DEPARTMENTS as readonly string[]).includes(value);
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border-border bg-background h-9 w-full rounded-md border px-2 text-sm"
    >
      <option value="">Not set</option>
      {DEPARTMENTS.map((department) => (
        <option key={department} value={department}>
          {department}
        </option>
      ))}
      {!isOnList && <option value={value}>{value}</option>}
    </select>
  );
}

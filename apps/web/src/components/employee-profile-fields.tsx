import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { EmployeeProfileDraft } from "./employee-profile-draft";

const FIELDS: {
  key: keyof EmployeeProfileDraft;
  label: string;
  type?: "date" | "tel";
}[] = [
  { key: "jobTitle", label: "Position / job title" },
  { key: "department", label: "Department" },
  { key: "employmentStartDate", label: "Employment start date", type: "date" },
  { key: "phone", label: "Phone", type: "tel" },
  { key: "address", label: "Address" },
  { key: "dateOfBirth", label: "Date of birth", type: "date" },
  { key: "emergencyContactName", label: "Emergency contact name" },
  { key: "emergencyContactPhone", label: "Emergency contact phone", type: "tel" },
];

/** The HR-editable employee_profiles fields, shared by Add staff and Edit profile. */
export function EmployeeProfileFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: EmployeeProfileDraft;
  onChange: (next: EmployeeProfileDraft) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {FIELDS.map(({ key, label, type }) => (
        <div key={key} className="space-y-1">
          <Label htmlFor={`${idPrefix}-${key}`} className="text-xs">
            {label}
          </Label>
          <Input
            id={`${idPrefix}-${key}`}
            type={type ?? "text"}
            value={draft[key]}
            onChange={(e) => onChange({ ...draft, [key]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

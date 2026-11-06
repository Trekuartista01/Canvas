export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

// Like Field, but a <div> instead of a <label> — for sections containing a
// list of independently-interactive elements (buttons, checkboxes) rather
// than a single form control. A <label> wrapping multiple controls gets its
// text folded into each control's accessible name, which is wrong here.
export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block space-y-1">
      <span className="text-muted-foreground text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

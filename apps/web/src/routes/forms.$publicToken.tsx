import { formatDue } from "@/lib/format";
import {
  PublicTaskAttachZone,
  type PublicUploadedFile,
} from "@/components/public-task-attach-zone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { TITLE_FIELD_ID } from "@canvas/shared";
import { createRoute } from "@tanstack/react-router";
import { useState } from "react";
import { rootRoute } from "./__root";

export const publicFormRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/forms/$publicToken",
  component: PublicFormPage,
});

function PublicFormPage() {
  const { publicToken } = publicFormRoute.useParams();
  const form = trpc.form.getPublic.useQuery({ publicToken });

  if (form.isLoading) {
    return <p className="text-muted-foreground p-8 text-sm">Loading…</p>;
  }

  if (!form.data) {
    return (
      <main className="flex min-h-svh items-center justify-center px-4 text-center">
        <p>This form link is no longer valid.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg space-y-4 px-4 py-10" data-testid="public-form-page">
      {form.data.taskId && form.data.task ? (
        <TaskCompletionForm publicToken={publicToken} name={form.data.name} task={form.data.task} />
      ) : (
        <IntakeForm publicToken={publicToken} name={form.data.name} fields={form.data.fields} />
      )}
    </main>
  );
}

// Bound to one existing task (form.taskId set): no custom fields — the
// external recipient just sees what's due, attaches whatever they made,
// and submits once when they're actually finished. Submitting marks the
// task done and notifies the workspace's Operations Managers.
function TaskCompletionForm({
  publicToken,
  name,
  task,
}: {
  publicToken: string;
  name: string;
  task: { title: string; dueDate: string | null; dueTime: string | null; done: boolean };
}) {
  const [submitterName, setSubmitterName] = useState("");
  const [files, setFiles] = useState<PublicUploadedFile[]>([]);
  const submit = trpc.form.submitPublic.useMutation();

  if (submit.isSuccess) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-medium">Thanks, {submitterName} — marked as done.</p>
        <p className="text-muted-foreground text-sm">The team has been notified.</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-lg font-semibold">{name}</h1>

      <div className="border-border space-y-1 rounded-md border p-3">
        <p className="text-sm font-medium">{task.title}</p>
        {task.dueDate && (
          <p className="text-muted-foreground text-xs">
            Due {formatDue(task.dueDate, task.dueTime)}
          </p>
        )}
        {task.done && (
          <p className="text-muted-foreground text-xs">
            This task is already marked done — submitting again is fine if you have more to attach.
          </p>
        )}
      </div>

      <div className="border-accent bg-accent-soft space-y-1 rounded-md border p-3 text-xs">
        <p className="font-medium">Only submit once you've actually finished this task.</p>
        <p className="text-muted-foreground">
          Attach whatever you made below, then hit Submit — that's what tells the team it's done.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate({ publicToken, submitterName: submitterName.trim() });
        }}
        className="space-y-4"
      >
        <div className="space-y-1">
          <label htmlFor="submitter-name" className="block text-sm font-medium">
            Your name
          </label>
          <Input
            id="submitter-name"
            value={submitterName}
            onChange={(e) => setSubmitterName(e.target.value)}
            required
            data-testid="public-form-submitter-name"
          />
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">Attachments</p>
          <PublicTaskAttachZone
            publicToken={publicToken}
            files={files}
            onChange={setFiles}
            disabled={submit.isPending}
          />
        </div>

        <Button type="submit" disabled={submit.isPending} data-testid="public-form-submit">
          {submit.isPending ? "Submitting…" : "Submit — I'm done"}
        </Button>
        {submit.error && <p className="text-sm text-red-500">{submit.error.message}</p>}
      </form>
    </>
  );
}

// The original "no bound task" mode: arbitrary fields build a brand new
// task from the submission.
function IntakeForm({
  publicToken,
  name,
  fields,
}: {
  publicToken: string;
  name: string;
  fields: { id: string; label: string; type: string; required: boolean; options?: string[] }[];
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const submit = trpc.form.submitPublic.useMutation();

  if (submit.isSuccess) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-medium">Thanks — your submission was received.</p>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-lg font-semibold">{name}</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate({ publicToken, values });
        }}
        className="space-y-4"
      >
        {fields.map((field) => (
          <div key={field.id} className="space-y-1">
            <label htmlFor={`field-${field.id}`} className="block text-sm font-medium">
              {field.label}
              {field.required && <span className="text-red-500"> *</span>}
            </label>
            {field.type === "long_text" ? (
              <textarea
                id={`field-${field.id}`}
                value={values[field.id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                required={field.required}
                rows={4}
                className="border-border focus-visible:ring-primary w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2"
                data-testid={`public-form-field-${field.id}`}
              />
            ) : field.type === "select" ? (
              <select
                id={`field-${field.id}`}
                value={values[field.id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                required={field.required}
                className="border-border bg-background h-9 w-full rounded-md border text-sm"
                data-testid={`public-form-field-${field.id}`}
              >
                <option value="">Select…</option>
                {field.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={`field-${field.id}`}
                value={values[field.id] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.id]: e.target.value }))}
                required={field.required}
                autoFocus={field.id === TITLE_FIELD_ID}
                data-testid={`public-form-field-${field.id}`}
              />
            )}
          </div>
        ))}

        <Button type="submit" disabled={submit.isPending} data-testid="public-form-submit">
          {submit.isPending ? "Submitting…" : "Submit"}
        </Button>
        {submit.error && <p className="text-sm text-red-500">{submit.error.message}</p>}
      </form>
    </>
  );
}

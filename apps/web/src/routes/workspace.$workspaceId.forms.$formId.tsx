import { FormFieldsEditor } from "@/components/form-fields-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { formSchemaSchema, type FormField } from "@canvas/shared";
import { createRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const formEditorRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/forms/$formId",
  component: FormEditorPage,
});

function FormEditorPage() {
  const { workspaceId, formId } = formEditorRoute.useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const form = trpc.form.get.useQuery({ formId });

  const [name, setName] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [copied, setCopied] = useState(false);
  const [taskQuery, setTaskQuery] = useState("");

  useEffect(() => {
    if (!form.data) return;
    setName(form.data.name);
    setFields(formSchemaSchema.parse(form.data.schemaJson).fields);
  }, [form.data]);

  const update = trpc.form.update.useMutation({
    onSuccess: () => void utils.form.get.invalidate({ formId }),
  });
  const boundTask = trpc.task.get.useQuery(
    { taskId: form.data?.taskId ?? "" },
    { enabled: !!form.data?.taskId },
  );
  const taskSearch = trpc.task.search.useQuery(
    { workspaceId, query: taskQuery },
    { enabled: taskQuery.trim().length >= 2 },
  );
  const remove = trpc.form.delete.useMutation({
    onSuccess: () => {
      void utils.form.list.invalidate({ workspaceId });
      void navigate({ to: "/w/$workspaceId/forms", params: { workspaceId } });
    },
  });

  function handleSave(e: FormEvent) {
    e.preventDefault();
    update.mutate({ formId, name: name.trim() || "Untitled form", fields });
  }

  if (form.isLoading || !form.data) {
    return <p className="text-muted-foreground p-6 text-sm">Loading…</p>;
  }

  const publicUrl = `${window.location.origin}/forms/${form.data.publicToken}`;

  return (
    <div className="max-w-lg space-y-4 p-6" data-testid="form-editor-page">
      <Link
        to="/w/$workspaceId/forms"
        params={{ workspaceId }}
        className="text-muted-foreground hover:text-foreground text-xs"
      >
        ← Forms
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">Edit form</h1>

      <div className="bg-card shadow-sm border-border space-y-1 rounded-md border p-3">
        <p className="text-xs font-medium">Public link</p>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={publicUrl}
            className="h-8 text-xs"
            data-testid="form-public-link"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(publicUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {form.data.taskId
            ? "Anyone with this link can attach files and mark the linked task done — no login required."
            : "Anyone with this link can submit — no login required."}
        </p>
      </div>

      <div
        className="bg-card shadow-sm border-border space-y-2 rounded-md border p-3"
        data-testid="form-task-bind"
      >
        <p className="text-xs font-medium">Bound task</p>
        <p className="text-muted-foreground text-xs">
          Bind this form to one task and it switches to "task completion" mode: the public page
          shows that task, a file-attach box, and a single Submit that marks it done — instead of
          building a new task from custom fields.
        </p>
        {form.data.taskId ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span data-testid="form-bound-task-title">{boundTask.data?.title ?? "Loading…"}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="form-unbind-task"
              onClick={() => update.mutate({ formId, taskId: null })}
            >
              Unbind
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            <Input
              value={taskQuery}
              onChange={(e) => setTaskQuery(e.target.value)}
              placeholder="Search tasks to bind…"
              className="h-8 text-sm"
              data-testid="form-bind-task-search"
            />
            {taskQuery.trim().length >= 2 && (taskSearch.data?.length ?? 0) > 0 && (
              <ul className="border-border max-h-40 divide-y overflow-y-auto rounded-md border text-sm">
                {taskSearch.data?.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      data-testid={`form-bind-task-result-${task.id}`}
                      className="hover:bg-muted flex w-full items-center justify-between px-3 py-2 text-left"
                      disabled={update.isPending}
                      onClick={() => {
                        update.mutate({ formId, taskId: task.id });
                        setTaskQuery("");
                      }}
                    >
                      <span>{task.title}</span>
                      <span className="text-muted-foreground text-xs">
                        {task.spaceName} / {task.listName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleSave} className="space-y-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Form name"
          className="h-8 text-sm"
          data-testid="form-editor-name"
        />

        {!form.data.taskId && <FormFieldsEditor fields={fields} onChange={setFields} />}

        <div className="flex gap-2">
          <Button
            type="submit"
            size="sm"
            disabled={update.isPending}
            data-testid="form-editor-save"
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => remove.mutate({ formId })}
            data-testid="form-editor-delete"
          >
            Delete form
          </Button>
        </div>
        {update.error && <p className="text-xs text-red-500">{update.error.message}</p>}
      </form>
    </div>
  );
}

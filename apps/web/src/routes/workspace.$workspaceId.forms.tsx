import { FormFieldsEditor } from "@/components/form-fields-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { TITLE_FIELD_ID, type FormField } from "@canvas/shared";
import { createRoute, Link } from "@tanstack/react-router";
import { ChevronRight, ClipboardList, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

export const formsListRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/forms",
  component: FormsListPage,
});

const DEFAULT_FIELDS: FormField[] = [
  { id: TITLE_FIELD_ID, label: "Title", type: "short_text", required: true },
];

function FormsListPage() {
  const { workspaceId } = formsListRoute.useParams();
  const utils = trpc.useUtils();
  const forms = trpc.form.list.useQuery({ workspaceId });
  const tree = trpc.hierarchy.tree.useQuery({ workspaceId });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [listId, setListId] = useState("");
  const [fields, setFields] = useState<FormField[]>(DEFAULT_FIELDS);

  const create = trpc.form.create.useMutation({
    onSuccess: () => {
      void utils.form.list.invalidate({ workspaceId });
      setCreating(false);
      setName("");
      setFields(DEFAULT_FIELDS);
      setListId("");
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!listId) return;
    create.mutate({ workspaceId, listId, name: name.trim() || "Untitled form", fields });
  }

  const listOptions =
    tree.data?.lists.map((list) => {
      const space = tree.data?.spaces.find((s) => s.id === list.spaceId);
      return { id: list.id, label: space ? `${space.name} / ${list.name}` : list.name };
    }) ?? [];

  return (
    <div className="space-y-4 p-6" data-testid="forms-list-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
            <ClipboardList className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Forms</h1>
            <p className="text-muted-foreground text-xs">
              Let anyone submit a task without logging in.
            </p>
          </div>
        </div>
        {!creating && (
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="forms-new"
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New form
          </Button>
        )}
      </div>

      {creating && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>New form</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Form name"
                className="h-8 text-sm"
                data-testid="forms-new-name"
              />
              <select
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                className="border-border bg-background h-8 w-full rounded border text-sm"
                data-testid="forms-new-list"
              >
                <option value="">Select a list…</option>
                {listOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <FormFieldsEditor fields={fields} onChange={setFields} />

              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={create.isPending || !listId}
                  data-testid="forms-create-submit"
                >
                  {create.isPending ? "Creating…" : "Create form"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
              </div>
              {create.error && <p className="text-xs text-red-500">{create.error.message}</p>}
            </form>
          </CardContent>
        </Card>
      )}

      {forms.isLoading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (forms.data?.length ?? 0) === 0 ? (
        <Card className="text-muted-foreground p-6 text-center text-sm">
          No forms yet. Create one to let people submit tasks without logging in.
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden p-0">
          {forms.data?.map((form) => (
            <Link
              key={form.id}
              to="/w/$workspaceId/forms/$formId"
              params={{ workspaceId, formId: form.id }}
              data-testid={`forms-link-${form.id}`}
              className="hover:bg-muted flex items-center justify-between gap-2 px-4 py-3 text-sm"
            >
              <span className="font-medium">{form.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  {new Date(form.updatedAt).toLocaleString()}
                </span>
                <ChevronRight className="text-muted-foreground h-4 w-4" aria-hidden />
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}

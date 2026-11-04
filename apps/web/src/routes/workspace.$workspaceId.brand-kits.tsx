import type { AppRouter } from "@canvas/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  COPY_LANGUAGES,
  DEFAULT_IMAGE_PROVIDER,
  IMAGE_PROVIDER_LABELS,
  IMAGE_PROVIDERS,
  type CopyLanguage,
  type ImageProvider,
} from "@canvas/shared";
import { createRoute } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import { Palette, Plus, Star, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { workspaceShellRoute } from "./workspace.$workspaceId";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type BrandKit = RouterOutputs["brandKit"]["list"][number];

const COPY_LANGUAGE_LABELS: Record<CopyLanguage, string> = {
  sq: "Shqip",
  en: "English",
  both: "Both",
};

export const brandKitsRoute = createRoute({
  getParentRoute: () => workspaceShellRoute,
  path: "/brand-kits",
  component: BrandKitsPage,
});

function BrandKitsPage() {
  const { workspaceId } = brandKitsRoute.useParams();

  return (
    <div className="space-y-6 p-6" data-testid="brand-kits-page">
      <div className="flex items-center gap-2">
        <span className="bg-accent-soft text-accent flex h-9 w-9 items-center justify-center rounded-md">
          <Palette className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Brand Kits</h1>
          <p className="text-muted-foreground text-xs">
            Save a palette, tone, and image style for each client or brand — assign one to a Space
            to apply it there automatically.
          </p>
        </div>
      </div>

      <BrandKitsSection workspaceId={workspaceId} />
      <SpaceAssignmentsSection workspaceId={workspaceId} />
    </div>
  );
}

function PaletteSwatches({ palette }: { palette: string[] }) {
  if (palette.length === 0) return null;
  return (
    <div className="flex gap-1">
      {palette.map((color) => (
        <span
          key={color}
          className="border-border h-4 w-4 rounded-full border"
          style={{ backgroundColor: color }}
          title={color}
        />
      ))}
    </div>
  );
}

function BrandKitsSection({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils();
  const kits = trpc.brandKit.list.useQuery({ workspaceId });
  const invalidate = () => utils.brandKit.list.invalidate({ workspaceId });

  const setDefault = trpc.brandKit.setDefault.useMutation({ onSuccess: invalidate });
  const deleteKit = trpc.brandKit.delete.useMutation({ onSuccess: invalidate });

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your brand kits</CardTitle>
        {!creating && (
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            data-testid="brand-kit-new"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New kit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {(kits.data?.length ?? 0) === 0 && !creating && (
          <p className="text-muted-foreground text-xs">
            No brand kits yet — create one below to feed image generation with a client's palette
            and tone.
          </p>
        )}

        {(kits.data ?? []).map((kit) =>
          editingId === kit.id ? (
            <BrandKitForm
              key={kit.id}
              workspaceId={workspaceId}
              kit={kit}
              onDone={() => setEditingId(null)}
            />
          ) : (
            <div
              key={kit.id}
              className="border-border flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
              data-testid={`brand-kit-${kit.id}`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">{kit.name}</p>
                  {kit.isDefault && (
                    <span className="bg-accent-soft text-accent flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium">
                      <Star className="h-2.5 w-2.5" aria-hidden />
                      Default
                    </span>
                  )}
                </div>
                <div className="text-muted-foreground flex items-center gap-2 text-xs">
                  <PaletteSwatches palette={kit.paletteJson ?? []} />
                  {kit.tone && <span className="truncate">{kit.tone}</span>}
                  <span>{IMAGE_PROVIDER_LABELS[kit.imageProvider as ImageProvider]}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!kit.isDefault && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDefault.mutate({ workspaceId, brandKitId: kit.id })}
                  >
                    Make default
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingId(kit.id)}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${kit.name}`}
                  title={`Delete ${kit.name}`}
                  onClick={() => deleteKit.mutate({ brandKitId: kit.id })}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </div>
          ),
        )}

        {creating && <BrandKitForm workspaceId={workspaceId} onDone={() => setCreating(false)} />}
      </CardContent>
    </Card>
  );
}

function BrandKitForm({
  workspaceId,
  kit,
  onDone,
}: {
  workspaceId: string;
  kit?: BrandKit;
  onDone: () => void;
}) {
  const utils = trpc.useUtils();
  const invalidate = () => utils.brandKit.list.invalidate({ workspaceId });

  const [name, setName] = useState(kit?.name ?? "");
  const [paletteText, setPaletteText] = useState((kit?.paletteJson ?? []).join(", "));
  const [tone, setTone] = useState(kit?.tone ?? "");
  const [guidelines, setGuidelines] = useState(kit?.guidelines ?? "");
  const [imageProvider, setImageProvider] = useState<ImageProvider>(
    (kit?.imageProvider as ImageProvider) ?? DEFAULT_IMAGE_PROVIDER,
  );
  const [fonts, setFonts] = useState(kit?.fonts ?? "");
  const [defaultCopyLanguage, setDefaultCopyLanguage] = useState<CopyLanguage>(
    (kit?.defaultCopyLanguage as CopyLanguage) ?? "sq",
  );
  const [error, setError] = useState<string | null>(null);

  const create = trpc.brandKit.create.useMutation({
    onSuccess: () => {
      invalidate();
      onDone();
    },
    onError: () => setError("Could not save — check hex colors look like #RRGGBB."),
  });
  const update = trpc.brandKit.update.useMutation({
    onSuccess: () => {
      invalidate();
      onDone();
    },
    onError: () => setError("Could not save — check hex colors look like #RRGGBB."),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const palette = paletteText
      .split(/[,\s]+/)
      .map((c) => c.trim())
      .filter(Boolean);
    const fields = {
      name: name.trim() || "Untitled kit",
      palette,
      tone: tone.trim() || null,
      guidelines: guidelines.trim() || null,
      imageProvider,
      fonts: fonts.trim() || null,
      defaultCopyLanguage,
    };
    if (kit) {
      update.mutate({ brandKitId: kit.id, ...fields });
    } else {
      create.mutate({ workspaceId, ...fields });
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border space-y-2 rounded-md border p-3"
      data-testid="brand-kit-form"
    >
      <div>
        <label htmlFor="brand-kit-name" className="mb-1 block text-xs font-medium">
          Name
        </label>
        <Input
          id="brand-kit-name"
          data-testid="brand-kit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme Corp"
        />
      </div>
      <div>
        <label htmlFor="brand-kit-palette" className="mb-1 block text-xs font-medium">
          Palette (comma-separated #RRGGBB)
        </label>
        <Input
          id="brand-kit-palette"
          data-testid="brand-kit-palette"
          value={paletteText}
          onChange={(e) => setPaletteText(e.target.value)}
          placeholder="#112233, #AABBCC"
        />
      </div>
      <div>
        <label htmlFor="brand-kit-tone" className="mb-1 block text-xs font-medium">
          Tone
        </label>
        <Input
          id="brand-kit-tone"
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          placeholder="Bold, playful…"
        />
      </div>
      <div>
        <label htmlFor="brand-kit-guidelines" className="mb-1 block text-xs font-medium">
          Guidelines
        </label>
        <textarea
          id="brand-kit-guidelines"
          value={guidelines}
          onChange={(e) => setGuidelines(e.target.value)}
          rows={2}
          className="border-border focus-visible:ring-primary w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2"
        />
      </div>
      <div>
        <label htmlFor="brand-kit-fonts" className="mb-1 block text-xs font-medium">
          Fonts
        </label>
        <Input
          id="brand-kit-fonts"
          data-testid="brand-kit-fonts"
          value={fonts}
          onChange={(e) => setFonts(e.target.value)}
          placeholder="Poppins Bold, Helvetica"
        />
      </div>
      <div>
        <label htmlFor="brand-kit-copy-language" className="mb-1 block text-xs font-medium">
          Default copy language
        </label>
        <select
          id="brand-kit-copy-language"
          data-testid="brand-kit-copy-language"
          value={defaultCopyLanguage}
          onChange={(e) => setDefaultCopyLanguage(e.target.value as CopyLanguage)}
          className="border-border bg-background h-8 w-full rounded border text-sm"
        >
          {COPY_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {COPY_LANGUAGE_LABELS[lang]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="brand-kit-image-engine" className="mb-1 block text-xs font-medium">
          Image engine
        </label>
        <select
          id="brand-kit-image-engine"
          data-testid="brand-kit-image-engine"
          value={imageProvider}
          onChange={(e) => setImageProvider(e.target.value as ImageProvider)}
          className="border-border bg-background h-8 w-full rounded border text-sm"
        >
          {IMAGE_PROVIDERS.map((provider) => (
            <option key={provider} value={provider}>
              {IMAGE_PROVIDER_LABELS[provider]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending} data-testid="brand-kit-save">
          {kit ? "Save changes" : "Create kit"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-status-critical text-xs">{error}</p>}
    </form>
  );
}

function SpaceAssignmentsSection({ workspaceId }: { workspaceId: string }) {
  const utils = trpc.useUtils();
  const tree = trpc.hierarchy.tree.useQuery({ workspaceId });
  const kits = trpc.brandKit.list.useQuery({ workspaceId });
  const setSpaceKit = trpc.hierarchy.space.update.useMutation({
    onSuccess: () => void utils.hierarchy.tree.invalidate({ workspaceId }),
  });

  const spaces = tree.data?.spaces ?? [];
  if (spaces.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Board assignments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-muted-foreground text-xs">
          Pick which brand kit applies inside each space — otherwise a space uses the workspace's
          default kit.
        </p>
        <ul className="divide-border divide-y rounded-md border" data-testid="space-kit-list">
          {spaces.map((space) => (
            <li
              key={space.id}
              className="flex items-center justify-between gap-2 p-2 text-sm"
              data-testid={`space-kit-${space.id}`}
            >
              <span className="truncate font-medium">{space.name}</span>
              <select
                value={space.brandKitId ?? ""}
                aria-label={`Brand kit for ${space.name}`}
                onChange={(e) =>
                  setSpaceKit.mutate({
                    spaceId: space.id,
                    brandKitId: e.target.value || null,
                  })
                }
                className="border-border bg-background h-7 rounded border text-xs"
              >
                <option value="">Use workspace default</option>
                {(kits.data ?? []).map((kit) => (
                  <option key={kit.id} value={kit.id}>
                    {kit.name}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

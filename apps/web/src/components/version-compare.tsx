export function VersionCompare({
  leftVersionId,
  rightVersionId,
  onClear,
}: {
  leftVersionId: string;
  rightVersionId: string;
  onClear?: () => void;
}) {
  return (
    <div data-testid="version-compare" className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Compare</p>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground text-[12px]"
            data-testid="version-compare-clear"
          >
            Clear
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <figure className="space-y-1">
          <img
            src={`/image-versions/${leftVersionId}`}
            alt="Selected version"
            data-testid="version-compare-left"
            className="border-border bg-muted aspect-square w-full rounded-md border object-contain"
          />
          <figcaption className="text-muted-foreground text-[12px]">Selected</figcaption>
        </figure>
        <figure className="space-y-1">
          <img
            src={`/image-versions/${rightVersionId}`}
            alt="Compare version"
            data-testid="version-compare-right"
            className="border-border bg-muted aspect-square w-full rounded-md border object-contain"
          />
          <figcaption className="text-muted-foreground text-[12px]">Compare</figcaption>
        </figure>
      </div>
    </div>
  );
}

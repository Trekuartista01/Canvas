// Minimal, dependency-free SVG charts for dashboard widgets (M5.2). Follows
// the project's dataviz skill: thin marks, rounded bar tops, a hairline
// baseline/gridline, native <title> tooltips as the hover layer, and the
// validated reference palette (categorical slots fixed-order, single hue
// for one-series charts) — see references/palette.md. Each chart is
// deliberately small; a real charting library would be overkill for four
// fixed widget shapes.

const CHART_HEIGHT = 140;
const CHART_WIDTH = 480;
const PADDING = 24;

// Categorical slots 1-4 (fixed order — never reassigned by value), plus the
// two single-series hues used by the trailing-history widgets.
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"] as const;
const CATEGORICAL_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500"] as const;

export function BarChart({
  data,
  color,
  valueLabel,
}: {
  data: { label: string; value: number }[];
  color: { light: string; dark: string };
  valueLabel: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerWidth = CHART_WIDTH - PADDING * 2;
  const innerHeight = CHART_HEIGHT - PADDING * 2;
  const barWidth = data.length > 0 ? innerWidth / data.length : innerWidth;
  const gap = Math.min(6, barWidth * 0.25);

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="w-full"
      role="img"
      aria-label="Bar chart"
    >
      <line
        x1={PADDING}
        y1={CHART_HEIGHT - PADDING}
        x2={CHART_WIDTH - PADDING}
        y2={CHART_HEIGHT - PADDING}
        className="stroke-border"
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const h = Math.max(2, (d.value / max) * innerHeight);
        const x = PADDING + i * barWidth + gap / 2;
        const y = CHART_HEIGHT - PADDING - h;
        const w = Math.max(1, barWidth - gap);
        return (
          <rect
            key={d.label}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={Math.min(4, w / 2)}
            className="[fill:var(--bar-color-light)] dark:[fill:var(--bar-color-dark)]"
            style={
              {
                "--bar-color-light": color.light,
                "--bar-color-dark": color.dark,
              } as React.CSSProperties
            }
          >
            <title>{`${d.label}: ${valueLabel(d.value)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export function CategoricalBarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerWidth = CHART_WIDTH - PADDING * 2;
  const innerHeight = CHART_HEIGHT - PADDING * 2;
  const barWidth = innerWidth / Math.max(1, data.length);
  const gap = Math.min(16, barWidth * 0.3);

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="w-full"
      role="img"
      aria-label="Bar chart of task counts by status"
    >
      <line
        x1={PADDING}
        y1={CHART_HEIGHT - PADDING}
        x2={CHART_WIDTH - PADDING}
        y2={CHART_HEIGHT - PADDING}
        className="stroke-border"
        strokeWidth={1}
      />
      {data.map((d, i) => {
        const h = Math.max(2, (d.value / max) * innerHeight);
        const x = PADDING + i * barWidth + gap / 2;
        const y = CHART_HEIGHT - PADDING - h;
        const w = Math.max(1, barWidth - gap);
        const light = CATEGORICAL[i % CATEGORICAL.length];
        const dark = CATEGORICAL_DARK[i % CATEGORICAL_DARK.length];
        return (
          <rect
            key={d.label}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={Math.min(4, w / 2)}
            style={{ "--bar-color-light": light, "--bar-color-dark": dark } as React.CSSProperties}
            className="[fill:var(--bar-color-light)] dark:[fill:var(--bar-color-dark)]"
          >
            <title>{`${d.label}: ${d.value}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

// Donut chart for one categorical series (e.g. tasks by status). Fixed slot
// order per the categorical palette; a legend is always rendered alongside
// since color is never the only identity cue.
export function DonutChart({
  data,
  centerLabel,
  centerValue,
}: {
  data: { label: string; value: number }[];
  centerLabel: string;
  centerValue: string;
}) {
  const size = 160;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(
    1,
    data.reduce((sum, d) => sum + d.value, 0),
  );

  let offset = 0;
  const segments = data.map((d, i) => {
    const fraction = d.value / total;
    const dash = fraction * circumference;
    const gap = Math.max(0, circumference - dash);
    const segment = {
      d,
      dash,
      gap,
      rotation: (offset / circumference) * 360,
      light: CATEGORICAL[i % CATEGORICAL.length],
      dark: CATEGORICAL_DARK[i % CATEGORICAL_DARK.length],
    };
    offset += dash;
    return segment;
  });

  return (
    <div className="flex items-center gap-4">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Donut chart of ${centerLabel}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="stroke-border"
          strokeWidth={stroke}
        />
        {segments.map((s) => (
          <circle
            key={s.d.label}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeDasharray={`${s.dash} ${s.gap}`}
            transform={`rotate(${s.rotation - 90} ${size / 2} ${size / 2})`}
            style={{ "--dot-light": s.light, "--dot-dark": s.dark } as React.CSSProperties}
            className="[stroke:var(--dot-light)] dark:[stroke:var(--dot-dark)]"
          >
            <title>{`${s.d.label}: ${s.d.value}`}</title>
          </circle>
        ))}
        <text
          x={size / 2}
          y={size / 2 - 4}
          textAnchor="middle"
          className="fill-foreground text-lg font-semibold"
        >
          {centerValue}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 16}
          textAnchor="middle"
          className="fill-muted-foreground text-[11px] uppercase"
        >
          {centerLabel}
        </text>
      </svg>
      <ul className="flex flex-col gap-1.5 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full [background:var(--dot-light)] dark:[background:var(--dot-dark)]"
              style={
                {
                  "--dot-light": CATEGORICAL[i % CATEGORICAL.length],
                  "--dot-dark": CATEGORICAL_DARK[i % CATEGORICAL_DARK.length],
                } as React.CSSProperties
              }
            />
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-medium">{d.value}</span>
            <span className="text-muted-foreground">
              ({total > 0 ? Math.round((d.value / total) * 100) : 0}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LineChart({
  data,
  color,
  valueLabel,
}: {
  data: { label: string; value: number }[];
  color: { light: string; dark: string };
  valueLabel: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerWidth = CHART_WIDTH - PADDING * 2;
  const innerHeight = CHART_HEIGHT - PADDING * 2;
  const stepX = data.length > 1 ? innerWidth / (data.length - 1) : 0;

  const points = data.map((d, i) => ({
    x: PADDING + i * stepX,
    y: CHART_HEIGHT - PADDING - (d.value / max) * innerHeight,
    d,
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      className="w-full"
      role="img"
      aria-label="Line chart"
      style={
        {
          "--line-color-light": color.light,
          "--line-color-dark": color.dark,
        } as React.CSSProperties
      }
    >
      <line
        x1={PADDING}
        y1={CHART_HEIGHT - PADDING}
        x2={CHART_WIDTH - PADDING}
        y2={CHART_HEIGHT - PADDING}
        className="stroke-border"
        strokeWidth={1}
      />
      <path
        d={path}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="[stroke:var(--line-color-light)] dark:[stroke:var(--line-color-dark)]"
      />
      {points.map((p) => (
        <circle
          key={p.d.label}
          cx={p.x}
          cy={p.y}
          r={3}
          className="[fill:var(--line-color-light)] dark:[fill:var(--line-color-dark)]"
        >
          <title>{`${p.d.label}: ${valueLabel(p.d.value)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

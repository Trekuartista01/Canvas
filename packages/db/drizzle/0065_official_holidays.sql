-- P8.2 (docs/hr-ops-spec.md §2): public_holidays becomes the spec's
-- official_holidays — one concrete non-working day per row, with Albanian and
-- English names, its year and a weekend-substitute flag. M7.4's
-- observed_date / is_recurring_fixed stay (unused) so this can be rolled
-- back by down/0065_official_holidays.down.sql. The scheduler tick then seeds
-- each workspace's current and next year (apps/api/src/lib/working-days.ts).
CREATE TABLE "public_holidays_backup_0065" (
	"id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
INSERT INTO "public_holidays_backup_0065" ("id") SELECT "id" FROM "public_holidays";--> statement-breakpoint
ALTER TABLE "public_holidays_backup_0065" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public_holidays" RENAME COLUMN "name" TO "name_en";--> statement-breakpoint
ALTER TABLE "public_holidays" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD COLUMN "name_sq" text;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD COLUMN "is_observed_substitute" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- A recurring M7.4 row becomes the concrete holiday of its anchor year; the
-- seed adds the other years.
UPDATE "public_holidays" SET
	"year" = EXTRACT(YEAR FROM "date")::integer,
	"name_sq" = CASE "name_en"
		WHEN 'New Year''s Day' THEN 'Viti i Ri'
		WHEN 'New Year''s Day (second day)' THEN 'Dita e dytë e Vitit të Ri'
		WHEN 'Orthodox Christmas' THEN 'Krishtlindjet Ortodokse'
		WHEN 'Independence Day' THEN 'Dita e Pavarësisë'
		WHEN 'Constitution Day' THEN 'Dita e Kushtetutës'
		WHEN 'Labour Day' THEN 'Dita Ndërkombëtare e Punës'
		WHEN 'Europe Day' THEN 'Dita e Evropës'
		WHEN 'Catholic Christmas' THEN 'Krishtlindjet Katolike'
		WHEN 'Catholic Easter Monday' THEN 'E hëna e Pashkëve Katolike'
		WHEN 'Orthodox Easter Monday' THEN 'E hëna e Pashkëve Ortodokse'
		WHEN 'Eid al-Fitr (Bajrami i Madh)' THEN 'Fitër Bajrami'
		WHEN 'Eid al-Adha (Kurban Bajrami)' THEN 'Kurban Bajrami'
		ELSE "name_en"
	END;--> statement-breakpoint
ALTER TABLE "public_holidays" ALTER COLUMN "year" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "public_holidays" ALTER COLUMN "name_sq" SET NOT NULL;--> statement-breakpoint
-- HR's M7.4 override of a movable holiday's day off becomes a substitute row
-- (UUIDv7 built in SQL: 48-bit ms timestamp + random, version/variant bits).
INSERT INTO "public_holidays" ("id", "workspace_id", "date", "year", "name_sq", "name_en", "is_observed_substitute", "created_by")
SELECT
	encode(
		set_bit(set_bit(overlay(uuid_send(gen_random_uuid())
			placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
			FROM 1 FOR 6), 52, 1), 53, 1),
		'hex')::uuid,
	"workspace_id",
	"observed_date",
	EXTRACT(YEAR FROM "observed_date")::integer,
	"name_sq" || ' (ditë zëvendësuese)',
	"name_en" || ' (substitute day)',
	true,
	"created_by"
FROM "public_holidays"
WHERE "observed_date" IS NOT NULL
	AND "observed_date" <> "date"
	AND NOT "is_recurring_fixed"
	AND "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "public_holidays_workspace_year_idx" ON "public_holidays" USING btree ("workspace_id","year");--> statement-breakpoint
CREATE TABLE "public_holiday_years" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"seeded_at" timestamp with time zone,
	"missing_notified_at" timestamp with time zone,
	CONSTRAINT "public_holiday_years_uniq" UNIQUE("workspace_id","year")
);
--> statement-breakpoint
ALTER TABLE "public_holiday_years" ADD CONSTRAINT "public_holiday_years_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_holiday_years" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "holiday_weekend_substitution" boolean DEFAULT true NOT NULL;

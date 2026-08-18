ALTER TYPE "public"."provider_name" ADD VALUE IF NOT EXISTS 'pekao';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bond_interest_tables" (
	"series_code" text NOT NULL,
	"purchase_day_key" smallint NOT NULL,
	"period_ordinal" integer NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"annual_rate" numeric(12, 6) NOT NULL,
	"daily_values" jsonb NOT NULL,
	"source" "provider_name" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bond_interest_tables_series_code_purchase_day_key_period_ordinal_pk" PRIMARY KEY("series_code","purchase_day_key","period_ordinal")
);

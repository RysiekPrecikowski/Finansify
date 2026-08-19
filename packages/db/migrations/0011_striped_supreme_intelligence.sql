-- Every statement below is re-runnable (`.claude/skills/db-migration`):
-- `neon-http` cannot run a multi-statement transaction, so a migration that
-- fails partway leaves whatever already ran committed with no journal row,
-- and the next run restarts the same file against objects it already
-- created. `IF NOT EXISTS` makes each `CREATE TABLE` a no-op on a retry
-- instead of a wedge.
CREATE TABLE IF NOT EXISTS "fx_rate_coverage" (
	"currency" text NOT NULL,
	"source" "provider_name" NOT NULL,
	"covered_from" date NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rate_coverage_currency_source_pk" PRIMARY KEY("currency","source")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "instrument_price_coverage" (
	"instrument_id" uuid NOT NULL,
	"source" "provider_name" NOT NULL,
	"covered_from" date NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_price_coverage_instrument_id_source_pk" PRIMARY KEY("instrument_id","source")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "instrument_price_coverage" ADD CONSTRAINT "instrument_price_coverage_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
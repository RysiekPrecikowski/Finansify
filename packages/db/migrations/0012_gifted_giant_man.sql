ALTER TYPE "public"."provider_name" ADD VALUE IF NOT EXISTS 'gpw';--> statement-breakpoint
ALTER TYPE "public"."provider_name" ADD VALUE IF NOT EXISTS 'bankier';--> statement-breakpoint
ALTER TABLE "instrument_prices" DROP CONSTRAINT "instrument_prices_instrument_id_date_pk";--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_instrument_id_date_source_pk" PRIMARY KEY("instrument_id","date","source");--> statement-breakpoint
ALTER TABLE "instrument_identifiers" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_identifiers" ADD COLUMN "fallback_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "instrument_identifiers" ADD COLUMN "last_fallback_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "instrument_identifiers_instrument_priority_idx" ON "instrument_identifiers" USING btree ("instrument_id","priority");
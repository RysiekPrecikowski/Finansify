ALTER TYPE "public"."instrument_kind" ADD VALUE IF NOT EXISTS 'catalyst_bond';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "catalyst_bond_terms" (
	"symbol" text PRIMARY KEY NOT NULL,
	"nominal" numeric(20, 8) NOT NULL,
	"currency" text NOT NULL,
	"source" "provider_name" NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);

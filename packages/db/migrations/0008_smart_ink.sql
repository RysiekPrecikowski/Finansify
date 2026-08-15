CREATE TYPE "public"."bond_family" AS ENUM('OTS', 'ROR', 'DOR', 'TOS', 'COI', 'ROS', 'EDO', 'ROD');--> statement-breakpoint
CREATE TYPE "public"."index_id" AS ENUM('nbp_reference', 'pl_cpi_yoy');--> statement-breakpoint
ALTER TYPE "public"."provider_name" ADD VALUE 'gus';--> statement-breakpoint
ALTER TYPE "public"."provider_name" ADD VALUE 'mf';--> statement-breakpoint
CREATE TABLE "bond_series_terms" (
	"series_code" text PRIMARY KEY NOT NULL,
	"family" "bond_family" NOT NULL,
	"first_period_rate" numeric(12, 6) NOT NULL,
	"margin" numeric(12, 6) NOT NULL,
	"source" "provider_name" NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_observations" (
	"index_id" "index_id" NOT NULL,
	"effective_from" date NOT NULL,
	"value" numeric(12, 6) NOT NULL,
	"source" "provider_name" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_observations_index_id_effective_from_pk" PRIMARY KEY("index_id","effective_from")
);

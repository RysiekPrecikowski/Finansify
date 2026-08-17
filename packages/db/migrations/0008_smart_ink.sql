-- Hand-edited after generation, deliberately: every statement below is
-- re-runnable. `neon-http` cannot run a multi-statement transaction, so a
-- migration that fails partway leaves the statements that already ran
-- committed and never records its journal row -- the next run restarts the
-- same file and dies on whichever object it already created. This file wedged
-- production that way on 2026-08-16 (issue #57).
--
-- That wedge is closed, and this edit did not close it -- the objects were
-- dropped and the migration re-run by hand before 13480eb5. What is left is
-- the shape of the recovery, which is worth keeping visible: there is no
-- `DROP VALUE` in Postgres, so the two `provider_name` labels below could not
-- have been undone by the drop-and-re-run that fixed the rest. An idempotent
-- file recovers from every state an interrupted run can leave; a drop-and-
-- re-run recovers from most of them.
--
-- So this is defence for a database built from an empty schema, and the
-- worked example of the form every later migration is written in
-- (`.claude/skills/db-migration`).
--
-- Editing an applied migration is safe here for a reason worth checking rather
-- than trusting: `neon-http`'s migrator records the file hash but never
-- compares it, selecting work by journal `when` against the last `created_at`
-- row. Production, pre-production and development all carry 0008's journal row
-- already, so none of them will see this file again.
DO $$ BEGIN
 CREATE TYPE "public"."bond_family" AS ENUM('OTS', 'ROR', 'DOR', 'TOS', 'COI', 'ROS', 'EDO', 'ROD');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."index_id" AS ENUM('nbp_reference', 'pl_cpi_yoy');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TYPE "public"."provider_name" ADD VALUE IF NOT EXISTS 'gus';--> statement-breakpoint
ALTER TYPE "public"."provider_name" ADD VALUE IF NOT EXISTS 'mf';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bond_series_terms" (
	"series_code" text PRIMARY KEY NOT NULL,
	"family" "bond_family" NOT NULL,
	"first_period_rate" numeric(12, 6) NOT NULL,
	"margin" numeric(12, 6) NOT NULL,
	"source" "provider_name" NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "index_observations" (
	"index_id" "index_id" NOT NULL,
	"effective_from" date NOT NULL,
	"value" numeric(12, 6) NOT NULL,
	"source" "provider_name" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "index_observations_index_id_effective_from_pk" PRIMARY KEY("index_id","effective_from")
);

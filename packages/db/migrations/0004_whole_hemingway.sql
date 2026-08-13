CREATE TYPE "public"."provider_name" AS ENUM('yahoo', 'nbp');--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"currency" text NOT NULL,
	"date" date NOT NULL,
	"mid" numeric(20, 8) NOT NULL,
	"source" "provider_name" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_currency_date_pk" PRIMARY KEY("currency","date")
);
--> statement-breakpoint
CREATE TABLE "instrument_identifiers" (
	"instrument_id" uuid NOT NULL,
	"provider" "provider_name" NOT NULL,
	"symbol" text NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_identifiers_instrument_id_provider_pk" PRIMARY KEY("instrument_id","provider"),
	CONSTRAINT "instrument_identifiers_provider_symbol_key" UNIQUE("provider","symbol")
);
--> statement-breakpoint
CREATE TABLE "instrument_prices" (
	"instrument_id" uuid NOT NULL,
	"date" date NOT NULL,
	"close" numeric(20, 8) NOT NULL,
	"currency" text NOT NULL,
	"source" "provider_name" NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instrument_prices_instrument_id_date_pk" PRIMARY KEY("instrument_id","date")
);
--> statement-breakpoint
ALTER TABLE "instrument_identifiers" ADD CONSTRAINT "instrument_identifiers_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_prices" ADD CONSTRAINT "instrument_prices_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;
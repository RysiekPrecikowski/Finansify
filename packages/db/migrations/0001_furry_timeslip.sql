CREATE TYPE "public"."wrapper" AS ENUM('brokerage', 'ike', 'ikze', 'ppk');--> statement-breakpoint
CREATE TYPE "public"."instrument_kind" AS ENUM('equity', 'etf', 'fund', 'bond');--> statement-breakpoint
CREATE TYPE "public"."fx_rate_source" AS ENUM('broker', 'nbp', 'user');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'import');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('buy', 'sell', 'dividend', 'interest', 'coupon', 'fee', 'tax', 'deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'split', 'bond_purchase', 'bond_redemption', 'bond_early_redemption');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"broker" text NOT NULL,
	"wrapper" "wrapper" NOT NULL,
	"currency" text NOT NULL,
	"opened_at" date NOT NULL,
	"closed_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "instrument_kind" NOT NULL,
	"isin" text,
	"symbol" text NOT NULL,
	"exchange" text,
	"currency" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_symbol_exchange_key" UNIQUE NULLS NOT DISTINCT("symbol","exchange")
);
--> statement-breakpoint
CREATE TABLE "portfolio_accounts" (
	"portfolio_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	CONSTRAINT "portfolio_accounts_portfolio_id_account_id_pk" PRIMARY KEY("portfolio_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid,
	"type" "transaction_type" NOT NULL,
	"trade_date" date NOT NULL,
	"settle_date" date,
	"currency" text NOT NULL,
	"fx_rate_source" "fx_rate_source",
	"encrypted" text NOT NULL,
	"source" "transaction_source" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"import_batch_id" uuid,
	"edited_after_import" boolean DEFAULT false NOT NULL,
	"matched_lot_ids" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wrapped_data_key" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_accounts" ADD CONSTRAINT "portfolio_accounts_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_accounts" ADD CONSTRAINT "portfolio_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "portfolios_user_id_idx" ON "portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolios_user_name_idx" ON "portfolios" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_external_id_idx" ON "transactions" USING btree ("account_id","external_id") WHERE external_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_user_account_trade_date_idx" ON "transactions" USING btree ("user_id","account_id","trade_date");
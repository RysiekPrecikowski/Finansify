ALTER TABLE "transactions" ADD COLUMN "quantity" numeric(28, 10) NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "price" numeric(28, 10);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "gross_amount" numeric(28, 10);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "fee" numeric(28, 10) NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "tax" numeric(28, 10) NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "fx_rate" numeric(28, 10);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "note" text;
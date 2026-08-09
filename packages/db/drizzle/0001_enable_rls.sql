-- Row Level Security.
--
-- The app always scopes queries by user_id in code. RLS is the second lock:
-- if a query ever forgets its filter, Postgres refuses the rows rather than
-- leaking another user's ledger. Both layers are required, neither is optional.
--
-- Written by hand because drizzle-kit does not generate policies. Any new
-- user-owned table must get the same treatment -- see docs/domain.md.

--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "portfolios" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "portfolio_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE POLICY "portfolios_owner" ON "portfolios"
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = "user_id")
  WITH CHECK ((SELECT auth.uid()) = "user_id");

--> statement-breakpoint
CREATE POLICY "accounts_owner" ON "accounts"
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = "user_id")
  WITH CHECK ((SELECT auth.uid()) = "user_id");

-- portfolio_accounts has no user_id of its own; ownership is inherited from both sides.
--> statement-breakpoint
CREATE POLICY "portfolio_accounts_owner" ON "portfolio_accounts"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "portfolios" p
      WHERE p."id" = "portfolio_accounts"."portfolio_id" AND p."user_id" = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "portfolios" p
      WHERE p."id" = "portfolio_accounts"."portfolio_id" AND p."user_id" = (SELECT auth.uid())
    )
    AND EXISTS (
      SELECT 1 FROM "accounts" a
      WHERE a."id" = "portfolio_accounts"."account_id" AND a."user_id" = (SELECT auth.uid())
    )
  );

-- Audit history is readable by its owner but never mutable from the client.
-- Writes go through the server, which uses the service role.
--> statement-breakpoint
CREATE POLICY "audit_events_owner_read" ON "audit_events"
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = "user_id");

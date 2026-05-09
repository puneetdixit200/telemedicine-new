ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

ALTER TABLE "User" ADD COLUMN "supabaseAuthUserId" TEXT;

CREATE UNIQUE INDEX "User_supabaseAuthUserId_key" ON "User"("supabaseAuthUserId");

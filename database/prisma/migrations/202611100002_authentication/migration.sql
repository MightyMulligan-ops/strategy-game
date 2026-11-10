BEGIN;

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('DISCORD', 'GOOGLE');

-- AlterTable
ALTER TABLE "PlayerIdentity" ADD COLUMN     "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "username" TEXT,
ADD COLUMN     "usernameKey" TEXT;

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "provider" "OAuthProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("provider","subject")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "generation" TEXT NOT NULL,
    "identityId" TEXT,
    "data" JSONB NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAttempt" (
    "state" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "sessionBinding" TEXT NOT NULL,
    "targetIdentityId" TEXT,
    "codeVerifier" TEXT NOT NULL,
    "nonce" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_identityId_provider_key" ON "OAuthAccount"("identityId", "provider");

-- CreateIndex
CREATE INDEX "AuthSession_identityId_idx" ON "AuthSession"("identityId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX "OAuthAttempt_sessionBinding_idx" ON "OAuthAttempt"("sessionBinding");

-- CreateIndex
CREATE INDEX "OAuthAttempt_expiresAt_idx" ON "OAuthAttempt"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerIdentity_usernameKey_key" ON "PlayerIdentity"("usernameKey");

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "PlayerIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "PlayerIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAttempt" ADD CONSTRAINT "OAuthAttempt_targetIdentityId_fkey" FOREIGN KEY ("targetIdentityId") REFERENCES "PlayerIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PlayerIdentity" ADD CONSTRAINT "valid_username" CHECK (
  ("username" IS NULL AND "usernameKey" IS NULL)
  OR ("username" IS NOT NULL AND "usernameKey" IS NOT NULL
    AND "username" COLLATE "C" ~ '^[A-Za-z][A-Za-z0-9_]{2,23}$'
    AND "usernameKey" = lower("username" COLLATE "C"))
);
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "valid_oauth_subject" CHECK (length("subject") BETWEEN 1 AND 255);
ALTER TABLE "AuthSession" ADD CONSTRAINT "valid_session_data" CHECK (jsonb_typeof("data") = 'object' AND length("generation") > 0);
ALTER TABLE "OAuthAttempt" ADD CONSTRAINT "valid_oauth_attempt" CHECK (
  length("state") > 0 AND length("sessionBinding") > 0 AND length("codeVerifier") BETWEEN 43 AND 128
  AND ("provider" <> 'GOOGLE' OR "nonce" IS NOT NULL)
);

COMMIT;

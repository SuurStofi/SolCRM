-- CreateTable
CREATE TABLE "BuyFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CONVERT_QUOTED',
    "usdtAmount" TEXT NOT NULL,
    "convertQuoteId" TEXT,
    "convertOrderId" TEXT,
    "convertedAt" DATETIME,
    "solReceived" TEXT,
    "destination" TEXT,
    "withdrawAttempt" INTEGER NOT NULL DEFAULT 0,
    "withdrawId" TEXT,
    "withdrawAmount" TEXT,
    "withdrawFee" TEXT,
    "withdrawTxId" TEXT,
    "withdrawnAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BuyFlow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BuyEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuyEvent_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "BuyFlow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BinanceCredential" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "apiKeyEnc" TEXT NOT NULL,
    "apiSecretEnc" TEXT NOT NULL,
    "apiKeyHint" TEXT NOT NULL,
    "canTrade" BOOLEAN NOT NULL DEFAULT false,
    "canWithdraw" BOOLEAN NOT NULL DEFAULT false,
    "ipRestricted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BinanceCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BinanceCredential" ("apiKeyEnc", "apiKeyHint", "apiSecretEnc", "createdAt", "updatedAt", "userId") SELECT "apiKeyEnc", "apiKeyHint", "apiSecretEnc", "createdAt", "updatedAt", "userId" FROM "BinanceCredential";
DROP TABLE "BinanceCredential";
ALTER TABLE "new_BinanceCredential" RENAME TO "BinanceCredential";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoWithdraw" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_User" ("createdAt", "id") SELECT "createdAt", "id" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "BuyFlow_userId_createdAt_idx" ON "BuyFlow"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BuyEvent_flowId_createdAt_idx" ON "BuyEvent"("flowId", "createdAt");

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userId" TEXT,
    "message" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "BinanceCredential" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "apiKeyEnc" TEXT NOT NULL,
    "apiSecretEnc" TEXT NOT NULL,
    "apiKeyHint" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BinanceCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_P2POrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "orderNumber" TEXT NOT NULL,
    "adNo" TEXT,
    "asset" TEXT NOT NULL DEFAULT 'USDT',
    "fiat" TEXT NOT NULL,
    "tradeType" TEXT NOT NULL DEFAULT 'SELL',
    "amount" TEXT,
    "price" TEXT,
    "totalFiat" TEXT,
    "payMethod" TEXT,
    "counterpartyName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "statusFromBinance" BOOLEAN NOT NULL DEFAULT false,
    "statusCheckedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "P2POrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_P2POrder" ("adNo", "amount", "asset", "counterpartyName", "createdAt", "fiat", "id", "notes", "orderNumber", "payMethod", "price", "status", "statusCheckedAt", "statusFromBinance", "totalFiat", "tradeType", "updatedAt") SELECT "adNo", "amount", "asset", "counterpartyName", "createdAt", "fiat", "id", "notes", "orderNumber", "payMethod", "price", "status", "statusCheckedAt", "statusFromBinance", "totalFiat", "tradeType", "updatedAt" FROM "P2POrder";
DROP TABLE "P2POrder";
ALTER TABLE "new_P2POrder" RENAME TO "P2POrder";
CREATE INDEX "P2POrder_status_idx" ON "P2POrder"("status");
CREATE INDEX "P2POrder_createdAt_idx" ON "P2POrder"("createdAt");
CREATE UNIQUE INDEX "P2POrder_userId_orderNumber_key" ON "P2POrder"("userId", "orderNumber");
CREATE TABLE "new_TransferFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "fromAddress" TEXT,
    "state" TEXT NOT NULL DEFAULT 'DRAFT',
    "amountSol" TEXT NOT NULL,
    "destinationTag" TEXT,
    "depositAddress" TEXT,
    "txSignature" TEXT,
    "chainConfirmedAt" DATETIME,
    "binanceCreditedAt" DATETIME,
    "creditedAmount" TEXT,
    "convertQuoteId" TEXT,
    "convertOrderId" TEXT,
    "convertedAt" DATETIME,
    "usdtReceived" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransferFlow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TransferFlow" ("amountSol", "binanceCreditedAt", "chainConfirmedAt", "convertOrderId", "convertQuoteId", "convertedAt", "createdAt", "creditedAmount", "depositAddress", "destinationTag", "id", "lastError", "state", "txSignature", "updatedAt", "usdtReceived") SELECT "amountSol", "binanceCreditedAt", "chainConfirmedAt", "convertOrderId", "convertQuoteId", "convertedAt", "createdAt", "creditedAmount", "depositAddress", "destinationTag", "id", "lastError", "state", "txSignature", "updatedAt", "usdtReceived" FROM "TransferFlow";
DROP TABLE "TransferFlow";
ALTER TABLE "new_TransferFlow" RENAME TO "TransferFlow";
CREATE UNIQUE INDEX "TransferFlow_txSignature_key" ON "TransferFlow"("txSignature");
CREATE INDEX "TransferFlow_userId_createdAt_idx" ON "TransferFlow"("userId", "createdAt");
CREATE INDEX "TransferFlow_state_idx" ON "TransferFlow"("state");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

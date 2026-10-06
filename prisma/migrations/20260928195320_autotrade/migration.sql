-- CreateTable
CREATE TABLE "AutoTradeConfig" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "fiat" TEXT NOT NULL DEFAULT 'UAH',
    "minPrice" TEXT NOT NULL,
    "amountSol" TEXT NOT NULL,
    "buyerMethod" TEXT,
    "payIds" TEXT NOT NULL DEFAULT '[]',
    "minOrderFiat" TEXT NOT NULL,
    "payTimeLimit" INTEGER NOT NULL DEFAULT 15,
    "lastCheck" TEXT,
    "lastCheckAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutoTradeConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutoTradeRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CONVERT_QUOTED',
    "fiat" TEXT NOT NULL,
    "amountSol" TEXT NOT NULL,
    "triggerAdNo" TEXT NOT NULL,
    "triggerPrice" TEXT NOT NULL,
    "triggerAdvertiser" TEXT,
    "convertQuoteId" TEXT,
    "convertOrderId" TEXT,
    "usdtReceived" TEXT,
    "advNo" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutoTradeRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutoTradeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutoTradeEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutoTradeRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AutoTradeRun_userId_createdAt_idx" ON "AutoTradeRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AutoTradeEvent_runId_createdAt_idx" ON "AutoTradeEvent"("runId", "createdAt");

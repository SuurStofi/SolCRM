-- CreateTable
CREATE TABLE "TransferFlow" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FlowEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FlowEvent_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "TransferFlow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "P2POrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TransferFlow_txSignature_key" ON "TransferFlow"("txSignature");

-- CreateIndex
CREATE INDEX "TransferFlow_state_idx" ON "TransferFlow"("state");

-- CreateIndex
CREATE INDEX "FlowEvent_flowId_createdAt_idx" ON "FlowEvent"("flowId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "P2POrder_orderNumber_key" ON "P2POrder"("orderNumber");

-- CreateIndex
CREATE INDEX "P2POrder_status_idx" ON "P2POrder"("status");

-- CreateIndex
CREATE INDEX "P2POrder_createdAt_idx" ON "P2POrder"("createdAt");

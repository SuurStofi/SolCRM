-- CreateTable
CREATE TABLE "BankConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentialEnc" TEXT,
    "tokenHint" TEXT,
    "label" TEXT,
    "consentAt" DATETIME NOT NULL,
    "lastSyncedAt" DATETIME,
    "lastError" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BankConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "maskedPan" TEXT,
    "iban" TEXT,
    "currencyCode" INTEGER NOT NULL,
    "balance" BIGINT NOT NULL DEFAULT 0,
    "creditLimit" BIGINT NOT NULL DEFAULT 0,
    "balanceUpdatedAt" DATETIME,
    "accountType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BankAccount_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bankAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "time" DATETIME NOT NULL,
    "amount" BIGINT NOT NULL,
    "operationAmount" BIGINT,
    "currencyCode" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "mcc" INTEGER,
    "hold" BOOLEAN NOT NULL DEFAULT false,
    "balance" BIGINT,
    "counterName" TEXT,
    "counterIban" TEXT,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "BankConnection_userId_idx" ON "BankConnection"("userId");

-- CreateIndex
CREATE INDEX "BankAccount_connectionId_idx" ON "BankAccount"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_connectionId_externalId_key" ON "BankAccount"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "BankTransaction_bankAccountId_time_idx" ON "BankTransaction"("bankAccountId", "time");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_bankAccountId_externalId_key" ON "BankTransaction"("bankAccountId", "externalId");

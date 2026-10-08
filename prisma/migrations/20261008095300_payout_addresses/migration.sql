-- CreateTable
CREATE TABLE "PayoutAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'paypal',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PayoutAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PayoutAddress_userId_idx" ON "PayoutAddress"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutAddress_userId_address_key" ON "PayoutAddress"("userId", "address");

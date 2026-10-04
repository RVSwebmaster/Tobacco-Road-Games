export const ORDINARY_PAYOUT_INCREMENT_CENTS = 1000;

export function maximumOrdinaryPayoutCents(payoutEligibleCents) {
  const eligible = Number(payoutEligibleCents);
  if (!Number.isInteger(eligible) || eligible <= 0) return 0;
  return (
    Math.floor(eligible / ORDINARY_PAYOUT_INCREMENT_CENTS) *
    ORDINARY_PAYOUT_INCREMENT_CENTS
  );
}

export function assertOrdinaryPayoutAmount(amountCents, payoutEligibleCents) {
  const amount = Number(amountCents),
    eligible = Number(payoutEligibleCents);
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error("Payout amount must use integer cents.");
  if (amount < ORDINARY_PAYOUT_INCREMENT_CENTS)
    throw new Error("Normal withdrawals require at least $10.");
  if (!Number.isInteger(eligible) || amount > eligible)
    throw new Error("Payout exceeds canonical eligible Creator liability.");
  if (amount % ORDINARY_PAYOUT_INCREMENT_CENTS !== 0)
    throw new Error("Ordinary payouts must be requested in $10 increments.");
  return amount;
}

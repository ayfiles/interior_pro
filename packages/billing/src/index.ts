import type { CreditLedgerEntry, CreditReservation } from "@interior-pro/shared";

export function calculateAvailableCredits(
  ledgerEntries: Pick<CreditLedgerEntry, "amount">[],
  reservations: Pick<CreditReservation, "amount" | "status" | "expiresAt">[],
  now = new Date(),
) {
  const ledgerBalance = ledgerEntries.reduce(
    (sum, entry) => sum + entry.amount,
    0,
  );

  const reservedCredits = reservations.reduce((sum, reservation) => {
    const expiresAt = new Date(reservation.expiresAt);

    if (reservation.status !== "reserved" || expiresAt <= now) {
      return sum;
    }

    return sum + reservation.amount;
  }, 0);

  return Math.max(ledgerBalance - reservedCredits, 0);
}

export function canReserveVideoCredit(
  ledgerEntries: Pick<CreditLedgerEntry, "amount">[],
  reservations: Pick<CreditReservation, "amount" | "status" | "expiresAt">[],
  now = new Date(),
) {
  return calculateAvailableCredits(ledgerEntries, reservations, now) >= 1;
}

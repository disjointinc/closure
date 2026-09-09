# Repayment Integration

Loan payments use the existing payment routes with a `loan` object (`loanId`
plus a positive `amount` in the loan currency/unit) and `invoiceIds: []`.
Invoice payments use `loan: null`. Loan allocation fields stay null until
success. Processing and failure have no loan effect.

Linked refunds use the existing refund routes with `paymentId` and one amount in
the original successful loan payment's currency/unit. Reversals consume remaining
original principal first, then interest. Only successful refunds consume the
refundable allocation; creation does not reserve funds, so settlement revalidates
the bounds. Unlinked refunds use explicit `paymentId: null` and never affect
loans.

Repeated success callbacks on the same payment/refund are no-ops. Conflicting
terminal callbacks return 409. Callbacks must reuse the created refund ID.

## Persistence

Loan linkage mirrors invoice linkage: `payment_loans` joins a payment to its
loan with the repayment amount and, after success, the interest/principal split
— just as `payment_invoices` joins a payment to its invoices. The `payments`
row itself carries no target-specific columns. A unique index enforces one
provider payment identity per tenant across both invoice and loan targets:

```sql
CREATE UNIQUE INDEX payments_provider ON payments (
  tenant_id,
  (provider_internals->>'provider'),
  (provider_internals->>'paymentId')
);
```

Matching replays return the original payment with its invoice IDs and loan
allocation. Changed targets, amounts, currency/unit, or customer IDs return 409.
Same-loan creation retries serialize on the loan lock; linked refund retries
serialize on the original payment lock. Unique indexes arbitrate concurrent
creates across different targets; the losing request returns 409 and can retry
to retrieve a matching existing resource.

Existing duplicate provider identities cause migration failure without deleting
or rewriting any records. No refund-provider integration changes are introduced.

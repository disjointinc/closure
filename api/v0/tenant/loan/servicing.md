# Loan Servicing

Fixed principal, no additional advances. Terms are copied from loan templates;
standalone loans do not depend on subscription assignments or billing cycles.
All state lives in Postgres. There are no Redis keys, timers, crons, or workers.

## Terms

Example inline creation body:

```json
{
  "assignmentId": null,
  "loanTemplateId": null,
  "principal": { "currency": "USD", "unit": "cents", "value": 100000 },
  "annualInterestPercentage": 12.5,
  "duration": { "days": null, "months": 12 },
  "servicingTerms": {
    "allocation": "interest_first",
    "interest": {
      "basis": "outstanding_principal",
      "calculation": "simple",
      "dayCount": "actual_365",
      "postMaturity": "stop"
    },
    "repayment": {
      "type": "periodic_minimum",
      "intervalMonths": 1,
      "minimum": {
        "type": "balance_percentage",
        "percentage": 5,
        "floor": { "currency": "USD", "unit": "cents", "value": 2500 }
      }
    }
  },
  "installments": []
}
```

- Allocation: `interest_first` or `principal_first`.
- Interest basis: `outstanding_principal` or `original_principal`.
- Day count: `actual_365` or `actual_360`; elapsed milliseconds represent fractional days.
- After maturity: `stop` or `accrue` at the same annual rate.
- Repayment: `periodic_minimum`, `fixed_schedule`, or `maturity_only`.
- Minimum: `balance_percentage` with a currency `floor`, or `fixed` with an `amount`.

Policies are required, not silently defaulted. Rates allow zero and at most six
decimal places. This version supports simple interest, not compounding. Periodic
minimums use calendar-month intervals anchored to origination in UTC, preserving
end-of-month. Amounts must use the principal's currency and unit.

Fixed schedules supply `installments: [{ amount, dueAt }]` at creation. Their
deadlines increase through maturity and total at most original principal; remaining
principal and accrued interest become due at maturity. This is not an amortization
schedule generator. Other repayment modes use an empty installments array.

## Accounting

Interest accrues lazily: the stored checkpoint (`servicingState`) only advances
when a settlement interaction (payment, refund, manual close) locks the loan row
and recalculates to the interaction's own timestamp. Reads project the checkpoint
to "now" in memory — the API always reports current balances, and nothing ever
runs on a schedule. There is no `nextServiceAt` and no servicing pass.

Obligations are computed, never stored: reads return a `due` array built from
unpaid past-due installment rows (arrears), the next periodic minimum (derived
from the current balance), and the maturity remainder. Only fixed-schedule rows
and refund-created reversal rows exist in `loan_installments`.

Interest uses bigint intermediates and carries fractional currency units between
checkpoints. Whole-unit payoff waives remaining sub-unit carry. Balances never
grow from computing obligations: they identify existing debt due. Minimums round
up, apply their floor, and cap at debt not already obligated. Missed obligations
remain outstanding without double-counting principal.

Successful payments allocate interest/principal under the loan lock and credit
oldest obligations. Extra payments reduce debt. Payoff closes the loan and cancels
unpaid future obligations without deleting history. Settlement always accrues to
its current time.

Refunds restore the original payment's allocated components at refund settlement,
create a current-due reversal obligation, and reopen paid-off loans. No interest is
backdated across a paid-off interval. See [repayment integration](../payment/repayment.md).
Manual installment marking cannot bypass monetary settlement. Archiving an active
serviced loan cannot forgive its debt.

## Migration

`0028_loan_servicing` renames rate columns without rescaling or deleting data.
Existing loans/templates have null servicing terms/state; old installment paid
flags are not fabricated into repayment balances. They remain readable, but require
explicit reconciliation before servicing. New templates require explicit terms.

`0029_payment_loans_lazy_servicing` removes the servicing schedule and moves loan
repayment linkage from `payments` columns into `payment_loans`, backfilling from
the old columns before dropping them. Refund `idempotency_key` is dropped: linked
refunds dedupe on the provider identity of their parent payment instead.

The payment-provider unique index intentionally fails on duplicate historical
provider payment identities. Reconcile those records before deployment; the
migration does not silently discard them. No migration is automatically run by
API startup.

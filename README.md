# Closure

Real-time, configurable metering, entitlements, billing, pricing versioning, and pricing experimentation. Built on a few principles:

1. Pricing should be managed in code
1. Pricing schemas should be immutable
1. Metering shouldn't introduce a visible delay for users
1. Metering actions should be idempotent
1. Payment info shouldn't be stored on your servers

## Getting started

### Guided (recommended)

Sign up for free at [disjoint.com](https://www.disjoint.com). Closure is enabled by default for all Disjoint users. We do some more nice things:

1. Set up metering and entitlement actions in your codebase
1. Set up payment processing
1. Integrate with the rest of the [Disjoint tool suite](https://www.disjoint.com/tools).

### Self-hosted (advanced)

If you want to self-host, you can deploy a hobby instance in one line on Linux using Docker.

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/disjointinc/rts/HEAD/bin/deploy-hobby)"
```

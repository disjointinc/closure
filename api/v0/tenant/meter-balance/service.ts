/**
 * v0/tenant/meter-balance/service.ts -- meter balance business logic: the live
 * balance read from Redis (api/cache/metering.ts).
 */
import { getMeterBalance } from "../../../cache/metering.ts";

export async function getBalance({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}): Promise<number | null> {
  return getMeterBalance({ meterId, tenantId });
}

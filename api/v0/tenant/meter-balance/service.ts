/**
 * v0/tenant/meter-balance/service.ts -- meter balance business logic: the live
 * balance read from Redis (api/cache/meter/metering.ts).
 */
import { getMeterBalance } from "../../../cache/meter/index.ts";

export async function getBalance({
  meterId,
  tenantId,
}: {
  meterId: string;
  tenantId: string;
}): Promise<number | null> {
  return getMeterBalance({ meterId, tenantId });
}

import { z } from "zod";
import type { ActiveAccountRecord } from "../core/activity/activityStore.js";

export const activeAccountResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("set"),
    account: z.string(),
    source: z.literal("wallet_connection"),
    setAt: z.string(),
    boundary: z.literal("read_context_only_not_signing_authorization")
  }),
  z.object({
    status: z.literal("none")
  })
]);

export type ActiveAccountResponse = z.infer<typeof activeAccountResponseSchema>;

export function activeAccountResponse(active: ActiveAccountRecord | undefined): ActiveAccountResponse {
  return active
    ? {
        status: "set",
        account: active.address,
        source: active.source,
        setAt: active.setAt,
        boundary: "read_context_only_not_signing_authorization"
      }
    : { status: "none" };
}

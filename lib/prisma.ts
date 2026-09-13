import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { currentTenantClient } from "@/lib/tenant/context";

const prismaClientSingleton = () => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  return new PrismaClient({ adapter });
};

declare const globalThis: {
  prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const base = globalThis.prismaGlobal ?? prismaClientSingleton();

if (process.env.NODE_ENV !== "production") globalThis.prismaGlobal = base;

/** The unscoped client. Only `withTenant` and deliberate cross-tenant jobs use it. */
export const basePrisma = base;

/**
 * The default client, which follows the ambient tenant scope.
 *
 * Inside `withTenant(...)` every call is routed to that transaction's client,
 * whose connection carries `app.tenant_id` — so Row-Level Security applies and
 * a query can only see the tenant being served. Outside a scope it falls
 * through to the base client, which under the non-owner application role sees
 * nothing at all.
 *
 * A Proxy rather than a re-export so existing call sites keep working
 * unchanged: `prisma.brainBlock.findMany(...)` resolves the right client at the
 * moment of the call rather than at import time.
 */
const prisma = new Proxy(base, {
  get(target, property) {
    const scoped = currentTenantClient();
    const source = (scoped ?? target) as unknown as Record<string | symbol, unknown>;

    const value = Reflect.get(source, property, source);
    // Model delegates and client methods must stay bound to the client they
    // came from; an unbound method would execute against the wrong connection.
    return typeof value === "function" ? value.bind(source) : value;
  },
}) as PrismaClient;

export default prisma;

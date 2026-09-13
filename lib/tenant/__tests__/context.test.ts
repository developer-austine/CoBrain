import { describe, expect, it } from "vitest";
import { currentScope, currentTenantId, runInTenantScope } from "../context";

/**
 * The scope is ambient, so the property that matters is that it follows async
 * continuations without leaking between concurrent requests. A module-level
 * variable would pass a single-request test and fail exactly here.
 */

const fakeClient = {} as never;

describe("tenant scope", () => {
  it("is undefined outside a scope", () => {
    expect(currentScope()).toBeUndefined();
    expect(currentTenantId()).toBeUndefined();
  });

  it("is visible inside the scope", async () => {
    const seen = await runInTenantScope({ tenantId: "t1", client: fakeClient }, async () =>
      currentTenantId()
    );
    expect(seen).toBe("t1");
  });

  it("survives awaits", async () => {
    const seen = await runInTenantScope({ tenantId: "t1", client: fakeClient }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      await Promise.resolve();
      return currentTenantId();
    });
    expect(seen).toBe("t1");
  });

  it("does not leak between concurrent scopes", async () => {
    // Two requests interleaving on one process must never observe each other's
    // tenant — this is the failure a global variable would produce.
    const results = await Promise.all(
      ["a", "b", "c", "d"].map((tenantId) =>
        runInTenantScope({ tenantId, client: fakeClient }, async () => {
          await new Promise((r) => setTimeout(r, Math.random() * 20));
          const first = currentTenantId();
          await new Promise((r) => setTimeout(r, Math.random() * 20));
          return [first, currentTenantId()];
        })
      )
    );

    expect(results).toEqual([
      ["a", "a"],
      ["b", "b"],
      ["c", "c"],
      ["d", "d"],
    ]);
  });

  it("does not outlive the scope", async () => {
    await runInTenantScope({ tenantId: "t1", client: fakeClient }, async () => undefined);
    expect(currentTenantId()).toBeUndefined();
  });

  it("restores the outer scope after a nested one", async () => {
    const observed: (string | undefined)[] = [];
    await runInTenantScope({ tenantId: "outer", client: fakeClient }, async () => {
      observed.push(currentTenantId());
      await runInTenantScope({ tenantId: "inner", client: fakeClient }, async () => {
        observed.push(currentTenantId());
      });
      observed.push(currentTenantId());
    });
    expect(observed).toEqual(["outer", "inner", "outer"]);
  });
});

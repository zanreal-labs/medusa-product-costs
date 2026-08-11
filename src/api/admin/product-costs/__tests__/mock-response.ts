import { vi } from "vitest";

/**
 * Shared test double for `MedusaResponse` across the `/admin/product-costs`
 * route tests. Not itself a `*.test.ts` file, so vitest does not pick it up
 * as a suite - only `route.test.ts` files import it.
 */
export function createMockResponse() {
  const res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } = {
    json: vi.fn(),
    status: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

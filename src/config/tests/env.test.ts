import { env, isDevelopment, isProduction, isTest } from "@/config";

describe("environment mode helpers", () => {
  it("exposes a single active environment mode", () => {
    expect(env.NODE_ENV).toBe("test");
    expect(isTest).toBe(true);
    expect(isDevelopment).toBe(false);
    expect(isProduction).toBe(false);
  });

  it("keeps the default refresh session window at seven days in tests", () => {
    expect(env.JWT_REFRESH_EXPIRES_IN).toBe("7d");
  });
});

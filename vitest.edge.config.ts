import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["supabase/functions/_shared/__tests__/ns-call-events.test.ts", "supabase/functions/_shared/__tests__/apns-provider-token.test.ts"],
    environment: "node",
  },
});

import { handleTrustedCoachingSlots } from "../../../lib/coaching-bridge.js";

Deno.serve((request) => handleTrustedCoachingSlots(request, {
  getEnv: (name: string) => Deno.env.get(name)
}));

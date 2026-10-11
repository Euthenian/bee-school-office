import { handleVerifyCoachBriefTicket } from "../../../lib/coach-brief-ticket.js";

Deno.serve((request) => handleVerifyCoachBriefTicket(request, {
  getEnv: (name: string) => Deno.env.get(name)
}));

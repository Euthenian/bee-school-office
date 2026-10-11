import { handleIssueCoachBriefTicket } from "../../../lib/coach-brief-ticket.js";

Deno.serve((request) => handleIssueCoachBriefTicket(request, {
  getEnv: (name: string) => Deno.env.get(name)
}));

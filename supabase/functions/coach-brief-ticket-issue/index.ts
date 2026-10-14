import { handleIssueCoachBriefTicket } from "../../../lib/coach-brief-ticket.js";
import { withCoachBriefBrowserCors } from "../../../lib/coach-brief-browser-cors.js";

Deno.serve((request) => withCoachBriefBrowserCors(request,
  (input: Request) => handleIssueCoachBriefTicket(input, { getEnv: (name: string) => Deno.env.get(name) })));

import { withCoachBriefBrowserCors } from "../../../lib/coach-brief-browser-cors.js";
import { handleCoachBriefSessions } from "../../../lib/coach-brief-sessions.js";

Deno.serve((request) => withCoachBriefBrowserCors(request,
  (input: Request) => handleCoachBriefSessions(input, { getEnv: (name: string) => Deno.env.get(name) })));

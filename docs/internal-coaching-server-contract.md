# Internal Coaching Pool: AI-EIGO server contract

Bee School Office owns Coach eligibility, school-local availability, Bee occupancy,
30-minute grid generation, and reservation integrity. AI-EIGO calls these operations
only from its authenticated server. Never put the bridge secret in a browser.

## Read final slots

`POST {SUPABASE_URL}/functions/v1/internal-coaching-slots`

Headers: `Authorization: Bearer {AI_EIGO_COACHING_BRIDGE_SECRET}` and
`Content-Type: application/json`. The Edge Function has gateway JWT verification
disabled and compares the bearer token to its dedicated bridge secret. It
rejects ordinary user, anonymous, and Bee service-role tokens. The Edge Function
uses its separate injected Bee server key for privileged database reads.

```json
{
  "school_id": "school UUID",
  "program_id": "kids",
  "start_date": "2026-10-05",
  "end_date": "2026-10-05"
}
```

`program_id` is an active Bee Coaching program ID, including `kids`, `eiken`,
`toeic`, or `icao` where configured. The date range is inclusive and at most
31 calendar days (`end_date <= start_date + 30`). Dates and times are local to
the returned school timezone; the caller must not convert them through its
browser timezone.

Success is HTTP 200 with only these fields:

```json
{
  "slots": [{
    "school_id": "school UUID",
    "program_id": "kids",
    "staff_id": "Coach staff UUID",
    "local_date": "2026-10-05",
    "start_time": "12:00",
    "end_time": "12:30",
    "timezone": "Asia/Tokyo"
  }]
}
```

An empty `slots` array means no confirmed candidate was bookable at query time.
The Edge Function uses the existing Bee facts RPC, JavaScript interval and grid
helpers, and a service-only batch check against the reservation RPC's live slot
state. It never returns raw facts, Coach contact details, students, or occupancy.
Bad input or an inactive/unknown school/program returns HTTP 400, missing or
incorrect credentials HTTP 401, a non-POST method HTTP 405, and upstream failure
HTTP 502. Missing Bee server configuration returns HTTP 503. Responses are not
cacheable. A displayed slot is an offer, not a hold: reservation rechecks it.

## Reserve one slot

AI-EIGO's server calls Bee Supabase RPC `reserve_internal_coaching_slot` using
the Bee service-role key. Input argument names and order are:

`p_school_id uuid, p_program_id text, p_staff_id uuid, p_local_date date,
p_start_time time, p_source text, p_learner_ref text, p_request_key text`.

Set `p_source` to `ai_eigo`. Use the selected slot's school, program, staff,
local date and start time. `p_learner_ref` is a nonempty opaque AI-EIGO learner
reference. `p_request_key` is a nonempty stable key for one booking attempt;
reuse it on retries. Bee has a unique `(source, request_key)` constraint. A
matching retry returns the original reservation state and
`"idempotent": true`; a different request with the same key returns
`{"status":"request_key_conflict"}`.

The JSON result status is one of `confirmed`, `cancelled` (matching retry of a
cancelled reservation), `invalid_request`, `invalid_slot`, `slot_unavailable`,
`unresolved_occupancy`, or `request_key_conflict`. A new success returns
`{"status":"confirmed","reservation_id":"UUID","idempotent":false}`.
Matching retries return `reservation_id` and `idempotent: true`. Other failures
return only `status`. Authorization failure raises SQLSTATE `42501`. Bee stores
the instant using `schools.timezone` and enforces a fixed-grid, 30-minute slot.

## Cancel a reservation

AI-EIGO's server calls Bee Supabase RPC
`cancel_internal_coaching_reservation(p_reservation_id uuid)` with the Bee
service-role key. The service role may cancel only a reservation whose source
is `ai_eigo`. The JSON result is `{"status":"cancelled",
"reservation_id":"UUID"}` or `{"status":"not_found"}`. An unauthorized
request raises SQLSTATE `42501`. Repeated cancellation returns `cancelled`.

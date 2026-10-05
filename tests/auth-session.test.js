import assert from "node:assert/strict";
import test from "node:test";
import { shouldReplaceVisibleSession } from "../lib/auth-session.js";

test("same-user session recovery on tab return keeps the visible session stable", () => {
  const session = { access_token: "before", user: { id: "user-1" } };
  const recovered = { access_token: "after", user: { id: "user-1" } };

  assert.equal(shouldReplaceVisibleSession(session, recovered, "SIGNED_IN"), false);
  assert.equal(shouldReplaceVisibleSession(session, recovered, "TOKEN_REFRESHED"), false);
});

test("auth identity changes and user updates still reach the UI", () => {
  const session = { user: { id: "user-1" } };

  assert.equal(shouldReplaceVisibleSession(null, session, "INITIAL_SESSION"), true);
  assert.equal(shouldReplaceVisibleSession(session, null, "SIGNED_OUT"), true);
  assert.equal(shouldReplaceVisibleSession(session, { user: { id: "user-2" } }, "SIGNED_IN"), true);
  assert.equal(shouldReplaceVisibleSession(session, { user: { id: "user-1" } }, "USER_UPDATED"), true);
});

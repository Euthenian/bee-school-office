import assert from "node:assert/strict";
import { isValidLocalInterval } from "../lib/staff-capacity.js";

assert.equal(isValidLocalInterval("12:00", "21:00"), true);
assert.equal(isValidLocalInterval("16:00", "18:00"), true);
assert.equal(isValidLocalInterval("12:00", "12:00"), false);
assert.equal(isValidLocalInterval("21:00", "12:00"), false);
assert.equal(isValidLocalInterval("23:30", "00:30"), false);
assert.equal(isValidLocalInterval("25:00", "26:00"), false);

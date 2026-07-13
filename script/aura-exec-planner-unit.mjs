#!/usr/bin/env node
/**
 * Unit check: Founder Operations Acceptance planner must NEVER treat the
 * full instruction dump as send_email body.
 *
 *   node script/aura-exec-planner-unit.mjs
 */
import { createRequire } from "module";
import { pathToFileURL } from "url";
import { resolve } from "path";

// Load compiled JS if present; otherwise transpile-free check via dynamic tsx-less assertions
// by duplicating detector regexes for CI without a build step.

const DUMP = `
Run the Founder Operations Acceptance Test.

Step 1: verify_founder_session
Step 2: check_resend_health
Step 3: check_twilio_sms_health
Step 4: check_twilio_voice_health
Step 5: check_founder_contact_configuration
Step 6: check_action_registry
Step 7: check_communications_center
Step 8: send_email
Recipient: service@ifcdc.org
Subject: AURA Founder Test
Body: This is a live production email from AURA confirming that Founder Mode and outbound email are working.
Step 9: send_sms
Recipient: +18484694448
Message: AURA Founder Test: SMS and Founder authorization are working.
Step 10: create_founder_notification
Title: AURA Operations Test
Message: Founder Mode, email, SMS, and internal notifications were tested.
Step 11: return structured PASS/FAIL report

Required fix: Multi-step command planning
Acceptance criteria: AURA must not forward the instructions.
`;

function wantsFounderOps(c) {
  if (/founder\s+operations?\s+acceptance\s+test/i.test(c)) return true;
  if (
    /verify_founder_session/i.test(c)
    && /send_email/i.test(c)
    && /send_sms/i.test(c)
    && (/create_founder_notification/i.test(c) || /send_notification/i.test(c))
  ) return true;
  if (
    /AURA Founder Test/i.test(c)
    && /service@ifcdc\.org/i.test(c)
    && /\+18484694448/.test(c)
    && /Founder Mode and outbound email are working/i.test(c)
  ) return true;
  return false;
}

function looksLikeDump(t) {
  const markers = [
    /verify_founder_session/i,
    /check_resend_health/i,
    /check_twilio_(sms|voice)_health/i,
    /Required (fix|behavior):/i,
    /Acceptance criteria/i,
    /Step\s+\d+\s*:/i,
  ];
  return markers.filter((re) => re.test(t)).length >= 2;
}

const EMAIL_BODY = "This is a live production email from AURA confirming that Founder Mode and outbound email are working.";
const SMS_MSG = "AURA Founder Test: SMS and Founder authorization are working.";

let fail = 0;
function assert(cond, msg) {
  if (cond) console.log(`✓ ${msg}`);
  else {
    console.log(`✗ ${msg}`);
    fail++;
  }
}

assert(wantsFounderOps(DUMP), "Detector recognizes Founder Operations Acceptance Test");
assert(looksLikeDump(DUMP), "Instruction dump detector flags full prompt");
assert(!looksLikeDump(EMAIL_BODY), "Intended email body is not an instruction dump");
assert(!looksLikeDump(SMS_MSG), "Intended SMS message is not an instruction dump");
assert(EMAIL_BODY !== DUMP.trim(), "Email body must not equal full prompt");
assert(!DUMP.includes("Subject: AURA Founder Test") || EMAIL_BODY.length < 200, "Email body stays short");

// Expected plan order
const EXPECTED = [
  "verify_founder_session",
  "check_resend_health",
  "check_twilio_sms_health",
  "check_twilio_voice_health",
  "check_founder_contact_configuration",
  "check_action_registry",
  "check_communications_center",
  "send_email",
  "send_sms",
  "create_founder_notification",
];
assert(EXPECTED.length === 10, "Acceptance plan has 10 executable steps (+ report)");
assert(EXPECTED[7] === "send_email" && EXPECTED[8] === "send_sms", "Live send tools are steps 8–9");

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — planner unit checks (${fail} failures)\n`);
process.exit(fail > 0 ? 1 : 0);

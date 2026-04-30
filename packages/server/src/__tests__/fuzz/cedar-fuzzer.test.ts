/**
 * Stream 4C — Cedar permission property-based fuzzer.
 *
 * Generates random Cedar policies (using a small but valid grammar of
 * templates) and random request triples (principal, action, resource).
 * Asserts:
 *   - If evaluatePolicy returned Allow → the policy text contains a
 *     permit clause for that principal/action combination.
 *   - If evaluatePolicy returned Deny → no matching permit exists for
 *     that exact principal and action, OR a forbid clause matches.
 *
 * This catches Cedar parser regressions and evaluator consistency bugs.
 * 100+ generated cases are run.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { evaluatePolicy } from "../../services/cedar.js";

// ---------------------------------------------------------------------------
// Cedar grammar arbitraries
// ---------------------------------------------------------------------------

const AGENT_IDS = ["agent-alpha", "agent-beta", "agent-gamma", "agent-delta", "bot-1", "bot-2"];
const ACTIONS = ["read", "write", "delete", "share", "admin"];
const RESOURCE_TYPES = ["Note", "Folder"];

const agentIdArb = fc.constantFrom(...AGENT_IDS);
const actionArb = fc.constantFrom(...ACTIONS);
const resourceTypeArb = fc.constantFrom(...RESOURCE_TYPES);
const resourceIdArb = fc.stringMatching(/^[a-z][a-z0-9\-]{2,15}$/).filter((s) => s.length >= 4);

// ---------------------------------------------------------------------------
// Policy template builders
// ---------------------------------------------------------------------------

/**
 * Build a simple permit policy for one principal and one action.
 * Shape:
 *   permit(
 *     principal == Agent::"<agentId>",
 *     action == Action::"<action>",
 *     resource is <ResourceType>
 *   );
 */
function buildPermitPolicy(agentId: string, action: string, resourceType: string): string {
  return `permit(\n  principal == Agent::"${agentId}",\n  action == Action::"${action}",\n  resource is ${resourceType}\n);`;
}

/**
 * Build a forbid policy for one principal and one action.
 */
function buildForbidPolicy(agentId: string, action: string, resourceType: string): string {
  return `forbid(\n  principal == Agent::"${agentId}",\n  action == Action::"${action}",\n  resource is ${resourceType}\n);`;
}

/**
 * Build a permit policy with an action set (in [...]).
 */
function buildPermitWithActionSet(agentId: string, actions: string[], resourceType: string): string {
  const actionList = actions.map((a) => `Action::"${a}"`).join(", ");
  return `permit(\n  principal == Agent::"${agentId}",\n  action in [${actionList}],\n  resource is ${resourceType}\n);`;
}

// ---------------------------------------------------------------------------
// Policy scenario arbitraries
// ---------------------------------------------------------------------------

interface PolicyScenario {
  /** Cedar policy text to evaluate */
  policyText: string;
  /** The request triple */
  request: {
    agentId: string;
    action: string;
    resourceType: string;
    resourceId: string;
  };
  /**
   * Whether the policy SHOULD allow this request, according to our
   * template logic (used to verify evaluator output).
   */
  expectedAllow: boolean;
}

/**
 * Scenario A: permit for exact principal+action+resource, matching request.
 * Expected: Allow.
 */
const exactMatchScenario: fc.Arbitrary<PolicyScenario> = fc
  .record({
    agentId: agentIdArb,
    action: actionArb,
    resourceType: resourceTypeArb,
    resourceId: resourceIdArb,
  })
  .map(({ agentId, action, resourceType, resourceId }) => ({
    policyText: buildPermitPolicy(agentId, action, resourceType),
    request: { agentId, action, resourceType, resourceId },
    expectedAllow: true,
  }));

/**
 * Scenario B: permit for one principal, request from a different principal.
 * Expected: Deny (no matching permit).
 */
const differentPrincipalScenario: fc.Arbitrary<PolicyScenario> = fc
  .record({
    permittedAgent: agentIdArb,
    requestingAgent: agentIdArb,
    action: actionArb,
    resourceType: resourceTypeArb,
    resourceId: resourceIdArb,
  })
  .filter(({ permittedAgent, requestingAgent }) => permittedAgent !== requestingAgent)
  .map(({ permittedAgent, requestingAgent, action, resourceType, resourceId }) => ({
    policyText: buildPermitPolicy(permittedAgent, action, resourceType),
    request: { agentId: requestingAgent, action, resourceType, resourceId },
    expectedAllow: false,
  }));

/**
 * Scenario C: permit with action set — request uses action in the set.
 * Expected: Allow.
 */
const actionSetMatchScenario: fc.Arbitrary<PolicyScenario> = fc
  .record({
    agentId: agentIdArb,
    actions: fc.uniqueArray(actionArb, { minLength: 2, maxLength: 4 }),
    resourceType: resourceTypeArb,
    resourceId: resourceIdArb,
  })
  .chain(({ agentId, actions, resourceType, resourceId }) =>
    fc
      .constantFrom(...actions)
      .map((chosenAction) => ({
        policyText: buildPermitWithActionSet(agentId, actions, resourceType),
        request: { agentId, action: chosenAction, resourceType, resourceId },
        expectedAllow: true,
      })),
  );

/**
 * Scenario D: explicit forbid — even if a permit would match, forbid wins.
 * Expected: Deny.
 */
const forbidOverridesScenario: fc.Arbitrary<PolicyScenario> = fc
  .record({
    agentId: agentIdArb,
    action: actionArb,
    resourceType: resourceTypeArb,
    resourceId: resourceIdArb,
  })
  .map(({ agentId, action, resourceType, resourceId }) => ({
    // Both permit AND forbid: Cedar forbid wins
    policyText: [
      buildPermitPolicy(agentId, action, resourceType),
      buildForbidPolicy(agentId, action, resourceType),
    ].join("\n"),
    request: { agentId, action, resourceType, resourceId },
    expectedAllow: false,
  }));

/**
 * Scenario E: empty policy — no permit, so always Deny.
 * Expected: Deny.
 */
const emptyPolicyScenario: fc.Arbitrary<PolicyScenario> = fc
  .record({
    agentId: agentIdArb,
    action: actionArb,
    resourceType: resourceTypeArb,
    resourceId: resourceIdArb,
  })
  .map(({ agentId, action, resourceType, resourceId }) => ({
    policyText: "",
    request: { agentId, action, resourceType, resourceId },
    expectedAllow: false,
  }));

/**
 * Scenario F: permit for a different action — request uses unmatched action.
 * Expected: Deny.
 */
const differentActionScenario: fc.Arbitrary<PolicyScenario> = fc
  .record({
    agentId: agentIdArb,
    permittedAction: actionArb,
    requestAction: actionArb,
    resourceType: resourceTypeArb,
    resourceId: resourceIdArb,
  })
  .filter(({ permittedAction, requestAction }) => permittedAction !== requestAction)
  .map(({ agentId, permittedAction, requestAction, resourceType, resourceId }) => ({
    policyText: buildPermitPolicy(agentId, permittedAction, resourceType),
    request: { agentId, action: requestAction, resourceType, resourceId },
    expectedAllow: false,
  }));

// Combined arbitrary — picks from all scenario types
const policyScenarioArb: fc.Arbitrary<PolicyScenario> = fc.oneof(
  exactMatchScenario,
  differentPrincipalScenario,
  actionSetMatchScenario,
  forbidOverridesScenario,
  emptyPolicyScenario,
  differentActionScenario,
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe("Cedar fuzzer — evaluator correctness", () => {
  it("Allow responses match permit logic, Deny responses match forbid/absent logic (100 cases)", async () => {
    await fc.assert(
      fc.asyncProperty(policyScenarioArb, async (scenario) => {
        const { policyText, request, expectedAllow } = scenario;

        const result = await evaluatePolicy(policyText, {
          principal: { type: "Agent", id: request.agentId },
          action: { type: "Action", id: request.action },
          resource: { type: request.resourceType, id: request.resourceId },
        });

        expect(
          result.allowed,
          [
            `Cedar evaluator result mismatch.`,
            `Policy: ${JSON.stringify(policyText)}`,
            `Request: ${JSON.stringify(request)}`,
            `Expected allow=${expectedAllow}, got allowed=${result.allowed}`,
            `Reasons: ${JSON.stringify(result.reasons)}`,
          ].join("\n"),
        ).toBe(expectedAllow);
      }),
      { numRuns: 100, verbose: false },
    );
  });
});

describe("Cedar fuzzer — no exceptions on valid policy text", () => {
  it("evaluatePolicy never throws for any generated policy scenario (50 cases)", async () => {
    await fc.assert(
      fc.asyncProperty(policyScenarioArb, async (scenario) => {
        const { policyText, request } = scenario;

        // The contract: evaluatePolicy ALWAYS resolves (never rejects)
        await expect(
          evaluatePolicy(policyText, {
            principal: { type: "Agent", id: request.agentId },
            action: { type: "Action", id: request.action },
            resource: { type: request.resourceType, id: request.resourceId },
          }),
        ).resolves.toBeDefined();
      }),
      { numRuns: 50, verbose: false },
    );
  });
});

describe("Cedar fuzzer — allow/deny consistency across multiple evaluations", () => {
  it("same policy + same request always returns same decision (idempotency, 50 cases)", async () => {
    await fc.assert(
      fc.asyncProperty(policyScenarioArb, async (scenario) => {
        const { policyText, request } = scenario;
        const input = {
          principal: { type: "Agent", id: request.agentId },
          action: { type: "Action", id: request.action },
          resource: { type: request.resourceType, id: request.resourceId },
        };

        const r1 = await evaluatePolicy(policyText, input);
        const r2 = await evaluatePolicy(policyText, input);

        expect(r1.allowed, "evaluatePolicy is not idempotent").toBe(r2.allowed);
      }),
      { numRuns: 50, verbose: false },
    );
  });
});

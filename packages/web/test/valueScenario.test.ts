import { describe, expect, test } from "bun:test";
import type { Milestone } from "@valueflow/domain";
import { applyScenarioValues, hasScenarioValues, scenarioMetricKey } from "../src/pages/valueScenario.ts";

const milestone: Milestone = {
  id: "m1",
  name: "Test",
  status: "eval",
  month: "2026-09",
  impact: { base: { fte: 5, time: 5 }, stretch: { fte: 8, time: 8 } },
  metrics: [{ id: "accuracy", label: "Accuracy", base: 80, stretch: 95, current: 72 }],
};

describe("value scenarios", () => {
  test("apply local values without mutating authoritative milestones", () => {
    const result = applyScenarioValues([milestone], { [scenarioMetricKey("m1", "accuracy")]: 96 });
    expect(result[0]?.metrics[0]?.current).toBe(96);
    expect(milestone.metrics[0]?.current).toBe(72);
    expect(result[0]).not.toBe(milestone);
  });

  test("only explicit values activate scenario mode", () => {
    expect(hasScenarioValues({})).toBe(false);
    expect(hasScenarioValues({ "m1/accuracy": 72 })).toBe(true);
  });
});

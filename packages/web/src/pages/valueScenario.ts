import type { Metric, Milestone } from "@valueflow/domain";

export const scenarioMetricKey = (milestoneId: string, metricId: string): string => `${milestoneId}/${metricId}`;

/** Apply local scenario values without mutating the authoritative project objects. */
export const applyScenarioValues = (milestones: Milestone[], values: Readonly<Record<string, number>>): Milestone[] =>
  milestones.map((milestone) => ({
    ...milestone,
    metrics: milestone.metrics.map((metric: Metric) => {
      const value = values[scenarioMetricKey(milestone.id, metric.id)];
      return value === undefined ? metric : { ...metric, current: value };
    }),
  }));

export const hasScenarioValues = (values: Readonly<Record<string, number>>): boolean => Object.keys(values).length > 0;

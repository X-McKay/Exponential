import { expect, test } from "bun:test";
import { partialField } from "../src/state/live.ts";

test("live JSON field decodes Unicode and waits for incomplete escapes", () => {
  expect(partialField('{"body":"caf\\u00e9"}', "body")).toBe("café");
  expect(partialField('{"body":"\\ud83d\\ude00"}', "body")).toBe("😀");
  expect(partialField('{"body":"caf\\u00', "body")).toBe("caf");
  expect(partialField('{"body":"quote: \\" ok\\nnext"}', "body")).toBe('quote: " ok\nnext');
});

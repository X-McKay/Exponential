// Start the local fixture provider and print how to reach it, for test
// runners that are not Bun (the Playwright suite). Stops on SIGTERM or
// when stdin closes.
import { startTestProvider } from "./provider.ts";

const provider = startTestProvider(process.env.PROVIDER_HOST ?? "127.0.0.1");
console.log(JSON.stringify({ baseUrl: provider.baseUrl, token: provider.token }));
const stop = () => {
  provider.stop();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
process.stdin.on("end", stop);
process.stdin.resume();

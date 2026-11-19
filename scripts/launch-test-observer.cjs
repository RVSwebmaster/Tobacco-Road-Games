const fs = require("node:fs");
const path = require("node:path");

const logPath = process.env.TRG_LAUNCH_RESULT_LOG;
const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const relativePath = scriptPath ? path.relative(process.cwd(), scriptPath) : "";
if (!logPath || !/^scripts[\\/]test-[^\\/]+\.js$/i.test(relativePath)) return;

const startedAt = process.hrtime.bigint();
process.once("exit", code => {
  const result = {
    phase: process.env.TRG_LAUNCH_PHASE || "npm test",
    script: relativePath.replaceAll("\\", "/"),
    status: code === 0 ? "PASS" : "FAIL",
    exitCode: Number(code),
    durationMs: Number((process.hrtime.bigint() - startedAt) / 1000000n)
  };
  try { fs.appendFileSync(logPath, `${JSON.stringify(result)}\n`); }
  catch { /* The gate will surface missing observation data as blocked. */ }
});

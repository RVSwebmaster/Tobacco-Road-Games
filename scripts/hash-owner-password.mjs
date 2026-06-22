import process from "node:process";
import { createPasswordHash } from "../functions/_lib/owner-auth.mjs";

const password = process.argv[2] || process.env.OWNER_PASSWORD_PLAIN || "";

if (!password) {
  console.error("Provide a password as the first argument or OWNER_PASSWORD_PLAIN.");
  process.exit(1);
}

const hash = await createPasswordHash(password);
console.log(hash);

#!/usr/bin/env node
/* global console */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "cli.js");

let content = readFileSync(cliPath, "utf8");

// Fix shebang: replace literal \n with actual newlines
if (content.startsWith("#!/usr/bin/env node\\n")) {
  content = content.replace(
    "#!/usr/bin/env node\\nimport { createRequire } from 'node:module';\\nconst require = createRequire(import.meta.url);",
    "#!/usr/bin/env node\nimport { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);"
  );
  writeFileSync(cliPath, content);
  console.log("Fixed shebang in dist/cli.js");
}

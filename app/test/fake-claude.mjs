// A fake `claude` CLI for the heart tests: dumps its argv (one per line), its stdin
// and its env to files in its working directory, then prints one JSON result.
// A Node script, so the runner can spawn it with the current node on every platform:
// Windows cannot run an extensionless #!/bin/sh script (spawn ENOENT), and since
// Node's CVE-2024-27980 fix it refuses a .bat/.cmd file without a shell (spawn EINVAL).
// (Not a test: `npm test` only runs test/*.test.mjs.)
import fs from 'node:fs';
fs.writeFileSync('args', process.argv.slice(2).join('\n') + '\n');
fs.writeFileSync('stdin', fs.readFileSync(0, 'utf8'));
fs.writeFileSync('env', Object.entries(process.env).map(([k, v]) => k + '=' + v).join('\n') + '\n');
console.log(JSON.stringify({ session_id: 'X', result: 'ok', total_cost_usd: 0.01 }));

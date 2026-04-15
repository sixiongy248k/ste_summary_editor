// Bumps the version field in manifest.json — called by semantic-release.
// Usage: node .github/scripts/bump-manifest.js <new-version>
const fs      = require('fs');
const version = process.argv[2];
if (!version) { console.error('Usage: bump-manifest.js <version>'); process.exit(1); }
const manifest  = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
manifest.version = version;
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 4) + '\n');
console.log(`manifest.json → v${version}`);

'use strict';
const fs = require('node:fs');
const path = require('node:path');

async function upload(file, name, client) {
  if (!/^bushin-snapshot-[0-9]+-[a-f0-9]{14}$/.test(name || '')) throw Error('Invalid snapshot name');
  const absolute = path.resolve(file || '');
  if (path.dirname(absolute) !== '/tmp/bushin-snapshots' ||
      !/^capture-[a-f0-9]{32}\.jpg$/.test(path.basename(absolute))) throw Error('Invalid snapshot path');
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) throw Error('Invalid snapshot file');
  const bytes = fs.readFileSync(absolute);
  if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw Error('Invalid JPEG');
  const result = await client.uploadArtifact(name, [absolute], path.dirname(absolute), {retentionDays: 1});
  if (!result.id) throw Error('No artifact ID');
  return {artifact_id: result.id};
}
module.exports = {upload};
if (require.main === module) {
  const {DefaultArtifactClient} = require('./snapshot-deps/node_modules/@actions/artifact');
  upload(process.argv[2], process.argv[3], new DefaultArtifactClient())
    .then(result => console.log(JSON.stringify(result)))
    .catch(() => {console.error('Snapshot upload failed'); process.exitCode = 1;});
}

// scripts/reset-db.js
// Deletes both local databases so the next start re-creates them (users are re-seeded).
// Stop both services before running this.

const fs = require('fs');
const path = require('path');

const files = [
  path.join(__dirname, '..', 'identity-service', 'identity.db'),
  path.join(__dirname, '..', 'api-service', 'taskflow.db'),
];
for (const f of files) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(f + suffix)) {
      fs.unlinkSync(f + suffix);
      console.log('Deleted', path.relative(process.cwd(), f + suffix));
    }
  }
}
console.log('Done. Start the services again to re-create the databases.');

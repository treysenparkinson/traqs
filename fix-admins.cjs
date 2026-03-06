const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');

fs.readFileSync('.env', 'utf8').split(/\r?\n/).forEach(line => {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
});

const s3 = new S3Client({
  region: process.env.MY_AWS_REGION,
  credentials: {
    accessKeyId: process.env.MY_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.MY_AWS_SECRET_ACCESS_KEY,
  },
});

async function getJson(key) {
  const r = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  return JSON.parse(await r.Body.transformToString());
}
async function putJson(key, data) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
  }));
}

async function run() {
  // ── Read current state ─────────────────────────────────────────────────────
  const config = await getJson('orgs/MATRIX/config.json');
  const people = await getJson('orgs/MATRIX/people.json').catch(() => []);
  console.log('Current adminEmail:', config.adminEmail);
  console.log('Current people count:', people.length);

  // ── Seed admin people ──────────────────────────────────────────────────────
  const admins = [
    { id: 99,  name: "Trey", email: "treysen@matrixpci.com" },
    { id: 100, name: "Max",  email: "max@matrixpci.com"     },
  ];

  let updated = [...people];
  for (const admin of admins) {
    const existing = updated.find(p => p.id === admin.id);
    if (existing) {
      // Update email if blank
      if (!existing.email) {
        existing.email = admin.email;
        existing.userRole = 'admin';
        console.log(`Updated ${admin.name} email → ${admin.email}`);
      } else {
        console.log(`${admin.name} already has email: ${existing.email} (no change)`);
      }
    } else {
      // Add fresh admin entry
      updated.push({
        id:       admin.id,
        name:     admin.name,
        role:     'Admin',
        cap:      8,
        color:    admin.id === 99 ? '#6366f1' : '#f43f5e',
        timeOff:  [],
        userRole: 'admin',
        email:    admin.email,
      });
      console.log(`Added ${admin.name} (${admin.email})`);
    }
  }

  // ── Update config: add adminEmails array ───────────────────────────────────
  const updatedConfig = {
    ...config,
    adminEmail:  "treysen@matrixpci.com",
    adminEmails: ["treysen@matrixpci.com", "max@matrixpci.com"],
  };

  // ── Write back ─────────────────────────────────────────────────────────────
  await putJson('orgs/MATRIX/people.json', updated);
  await putJson('orgs/MATRIX/config.json', updatedConfig);

  console.log('\nDone. People count now:', updated.length);
  console.log('Config adminEmail set to:', updatedConfig.adminEmail);
  console.log('Config adminEmails:', updatedConfig.adminEmails);
}

run().catch(e => { console.error(e); process.exit(1); });

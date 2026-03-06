const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
// Load .env manually (no dotenv package needed)
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
  const config = await getJson('orgs/MATRIX/config.json').catch(e => ({ error: e.message }));
  const people = await getJson('orgs/MATRIX/people.json').catch(e => ({ error: e.message }));

  console.log('\n── CONFIG ──────────────────────────────');
  console.log(JSON.stringify(config, null, 2));
  console.log('\n── PEOPLE (name / email / role) ────────');
  if (Array.isArray(people)) {
    people.forEach(p => console.log(`  id:${p.id}  ${p.name.padEnd(18)} email: "${p.email || ''}"  userRole: ${p.userRole}`));
    console.log(`  Total: ${people.length}`);
  } else {
    console.log(JSON.stringify(people, null, 2));
  }
}

run().catch(console.error);

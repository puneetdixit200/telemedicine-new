const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('demo seed data contract', () => {
  it('defines deterministic demo credentials for every supported role', () => {
    const seed = readText('prisma/seed.js');

    for (const email of [
      'patient.asha@example.com',
      'patient.ravi@example.com',
      'doctor.asha@example.com',
      'doctor.ravi@example.com',
      'admin.demo@example.com',
      'helper.meena@example.com'
    ]) {
      expect(seed).toContain(email);
    }

    expect(seed).toContain("password: 'Demo@12345'");
    expect(seed).toContain("role: 'patient'");
    expect(seed).toContain("role: 'doctor'");
    expect(seed).toContain("role: 'admin'");
    expect(seed).toContain("role: 'help_worker'");
  });

  it('keeps demo seeding idempotent with upsert operations', () => {
    const seed = readText('prisma/seed.js');

    expect(seed).toContain('prisma.user.upsert');
    expect(seed).toContain('createOrUpdateAuthUser');
    expect(seed).toContain('supabaseAuthUserId');
    expect(seed).toContain('prisma.slot.upsert');
    expect(seed).toContain('prisma.appointment.upsert');
    expect(seed).toContain('skipDuplicates: true');
  });
});

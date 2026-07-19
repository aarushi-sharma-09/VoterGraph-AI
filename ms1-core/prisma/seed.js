const prisma = require('../src/lib/prisma');
const bcrypt = require('bcrypt');

async function main() {
  const adminEmail = 'admin@votergraph.gov.in';
  
  console.log(`Checking for existing admin: ${adminEmail}...`);
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail }
  });

  if (existingAdmin) {
    console.log("Admin already exists. Skipping seed.");
    return;
  }

  const saltRounds = 10;
  const passwordHash = await bcrypt.hash('AdminSecure2024!', saltRounds);

  await prisma.user.create({
    data: {
      email: adminEmail,
      passwordHash,
      role: 'CIVIC_ADMIN'
    }
  });

  console.log("✅ Root Admin created");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

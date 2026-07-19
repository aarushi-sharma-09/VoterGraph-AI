// ─────────────────────────────────────────────────────────────────────────────
// prisma/seedGeo.js
// Seed placeholder data for Geo references (State, District, Constituency, PollingStation)
//
// ⚠️ NOTE: This is a placeholder since the ms2 ingestion pipeline does not exist in this repo.
// Run this manually once to populate the lookup tables:
//   node prisma/seedGeo.js
// ─────────────────────────────────────────────────────────────────────────────
const prisma = require('../src/lib/prisma');

async function main() {
  console.log('🌱 Seeding Geo Data...');

  // State
  const state = await prisma.state.upsert({
    where: { code: 'MH' },
    update: {},
    create: {
      name: 'Maharashtra',
      code: 'MH',
    },
  });

  // Districts
  const mumbai = await prisma.district.upsert({
    where: { stateId_code: { stateId: state.id, code: 'MUM' } },
    update: {},
    create: {
      name: 'Mumbai City',
      code: 'MUM',
      stateId: state.id,
    },
  });

  const pune = await prisma.district.upsert({
    where: { stateId_code: { stateId: state.id, code: 'PUN' } },
    update: {},
    create: {
      name: 'Pune',
      code: 'PUN',
      stateId: state.id,
    },
  });

  // Constituencies
  const colaba = await prisma.constituency.upsert({
    where: { districtId_code: { districtId: mumbai.id, code: '187' } },
    update: {},
    create: {
      name: 'Colaba',
      code: '187',
      districtId: mumbai.id,
    },
  });

  const mumbadevi = await prisma.constituency.upsert({
    where: { districtId_code: { districtId: mumbai.id, code: '186' } },
    update: {},
    create: {
      name: 'Mumbadevi',
      code: '186',
      districtId: mumbai.id,
    },
  });

  const kothrud = await prisma.constituency.upsert({
    where: { districtId_code: { districtId: pune.id, code: '210' } },
    update: {},
    create: {
      name: 'Kothrud',
      code: '210',
      districtId: pune.id,
    },
  });

  const shivajinagar = await prisma.constituency.upsert({
    where: { districtId_code: { districtId: pune.id, code: '212' } },
    update: {},
    create: {
      name: 'Shivajinagar',
      code: '212',
      districtId: pune.id,
    },
  });

  // Polling Stations
  const pollingStations = [
    // Colaba
    { number: '1', name: 'RC Church High School', constituencyId: colaba.id },
    { number: '2', name: 'Navy Nagar Community Hall', constituencyId: colaba.id },
    // Mumbadevi
    { number: '45', name: 'Babulnath Municipal School', constituencyId: mumbadevi.id },
    { number: '46', name: 'Chowpatty Health Center', constituencyId: mumbadevi.id },
    // Kothrud
    { number: '101', name: 'MIT College Room 1', constituencyId: kothrud.id },
    { number: '102', name: 'Karve Nagar Vidyalaya', constituencyId: kothrud.id },
    // Shivajinagar
    { number: '15', name: 'Fergusson College Main Hall', constituencyId: shivajinagar.id },
    { number: '16', name: 'Modern High School', constituencyId: shivajinagar.id },
  ];

  for (const ps of pollingStations) {
    await prisma.pollingStation.upsert({
      where: { constituencyId_number: { constituencyId: ps.constituencyId, number: ps.number } },
      update: {},
      create: ps,
    });
  }

  console.log('✅ Geo data seeded successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Geo seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

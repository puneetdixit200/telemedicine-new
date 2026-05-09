const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Demo@12345';

const DEMO_IDS = {
  patientAsha: '10000000-0000-4000-8000-000000000001',
  patientRavi: '10000000-0000-4000-8000-000000000002',
  doctorAsha: '10000000-0000-4000-8000-000000000003',
  doctorRavi: '10000000-0000-4000-8000-000000000004',
  admin: '10000000-0000-4000-8000-000000000005',
  helperMeena: '10000000-0000-4000-8000-000000000006',
  familyMember: '20000000-0000-4000-8000-000000000001',
  completedAppointment: '30000000-0000-4000-8000-000000000001',
  upcomingAppointment: '30000000-0000-4000-8000-000000000002',
  prescription: '40000000-0000-4000-8000-000000000001',
  pharmacyOrder: '50000000-0000-4000-8000-000000000001',
  labOrder: '60000000-0000-4000-8000-000000000001',
  labOrderItem: '60000000-0000-4000-8000-000000000002',
  vital: '70000000-0000-4000-8000-000000000001',
  reminder: '80000000-0000-4000-8000-000000000001',
  supportLink: '90000000-0000-4000-8000-000000000001',
  consentAudit: '90000000-0000-4000-8000-000000000002',
  patientToken: 'a0000000-0000-4000-8000-000000000001',
  chronicPlan: 'b0000000-0000-4000-8000-000000000001',
  carePlanCheckIn: 'b0000000-0000-4000-8000-000000000002',
  doctorReview: 'c0000000-0000-4000-8000-000000000001',
  callSession: 'd0000000-0000-4000-8000-000000000001'
};

const DEMO_USERS = [
  {
    id: DEMO_IDS.patientAsha,
    email: 'patient.asha@example.com',
    password: 'Demo@12345',
    role: 'patient',
    fullName: 'Asha Devi',
    phone: '9999991001',
    gender: 'female',
    dateOfBirth: '1988-04-12',
    address: 'Village Rampur, District Sitapur',
    language: 'Hindi',
    timeZone: 'Asia/Kolkata',
    patientProfile: {
      chronicConditions: 'Hypertension; seasonal asthma',
      basicHealthInfo: 'BP usually 138/88. Uses inhaler during crop burning season.',
      abhaId: '91-1234-5678-9012',
      abhaAddress: 'asha.devi@abdm'
    }
  },
  {
    id: DEMO_IDS.patientRavi,
    email: 'patient.ravi@example.com',
    password: 'Demo@12345',
    role: 'patient',
    fullName: 'Ravi Patel',
    phone: '9999991002',
    gender: 'male',
    dateOfBirth: '1979-11-03',
    address: 'Village Nandpur, District Barabanki',
    language: 'Hindi',
    timeZone: 'Asia/Kolkata',
    patientProfile: {
      chronicConditions: 'Type 2 diabetes',
      basicHealthInfo: 'Fasting glucose often between 135-155 mg/dL.'
    }
  },
  {
    id: DEMO_IDS.doctorAsha,
    email: 'doctor.asha@example.com',
    password: 'Demo@12345',
    role: 'doctor',
    fullName: 'Dr. Asha Kumar',
    phone: '8888881001',
    gender: 'female',
    address: 'Rural Care Clinic, Lucknow',
    language: 'Hindi,English',
    timeZone: 'Asia/Kolkata',
    doctorProfile: {
      specialization: 'General Medicine',
      yearsOfExperience: 8,
      qualifications: 'MBBS, DNB Family Medicine',
      clinicName: 'Rural Care Clinic',
      consultationLanguages: 'Hindi,English',
      description: 'Primary care physician focused on chronic disease follow-up.',
      callEnabled: true,
      statusMessage: 'Available for morning teleconsults'
    }
  },
  {
    id: DEMO_IDS.doctorRavi,
    email: 'doctor.ravi@example.com',
    password: 'Demo@12345',
    role: 'doctor',
    fullName: 'Dr. Ravi Singh',
    phone: '8888881002',
    gender: 'male',
    address: 'Skin Health Teleclinic, Varanasi',
    language: 'Hindi,English',
    timeZone: 'Asia/Kolkata',
    doctorProfile: {
      specialization: 'Dermatology',
      yearsOfExperience: 6,
      qualifications: 'MD Dermatology',
      clinicName: 'Skin Health Teleclinic',
      consultationLanguages: 'Hindi,English',
      description: 'Dermatologist for rashes, infections, and long-running skin concerns.',
      callEnabled: true,
      statusMessage: 'Online for follow-up reviews'
    }
  },
  {
    id: DEMO_IDS.admin,
    email: 'admin.demo@example.com',
    password: 'Demo@12345',
    role: 'admin',
    fullName: 'Demo Admin',
    phone: '7777771001',
    language: 'English',
    timeZone: 'Asia/Kolkata'
  },
  {
    id: DEMO_IDS.helperMeena,
    email: 'helper.meena@example.com',
    password: 'Demo@12345',
    role: 'help_worker',
    fullName: 'Meena Verma',
    phone: '9999992001',
    gender: 'female',
    address: 'Rampur Health Sub-Centre',
    language: 'Hindi',
    timeZone: 'Asia/Kolkata'
  }
];

const DEMO_LAB_CATALOG = [
  {
    code: 'CBC',
    name: 'Complete Blood Count',
    category: 'Hematology',
    sampleType: 'Blood',
    fastingRequired: false,
    turnaroundHours: 24,
    priceCents: 60000,
    isActive: true
  },
  {
    code: 'LFT',
    name: 'Liver Function Test',
    category: 'Biochemistry',
    sampleType: 'Blood',
    fastingRequired: true,
    turnaroundHours: 36,
    priceCents: 90000,
    isActive: true
  },
  {
    code: 'KFT',
    name: 'Kidney Function Test',
    category: 'Biochemistry',
    sampleType: 'Blood',
    fastingRequired: true,
    turnaroundHours: 36,
    priceCents: 90000,
    isActive: true
  },
  {
    code: 'HBA1C',
    name: 'HbA1c',
    category: 'Diabetes',
    sampleType: 'Blood',
    fastingRequired: false,
    turnaroundHours: 48,
    priceCents: 75000,
    isActive: true
  },
  {
    code: 'TSH',
    name: 'Thyroid Stimulating Hormone',
    category: 'Hormones',
    sampleType: 'Blood',
    fastingRequired: false,
    turnaroundHours: 48,
    priceCents: 70000,
    isActive: true
  }
];

function date(value) {
  return new Date(value);
}

function nullableDate(value) {
  return value ? date(value) : null;
}

async function upsertUser({ id, email, password, role, fullName, phone, doctorProfile, patientProfile, ...profile }) {
  const passwordHash = await bcrypt.hash(password, 12);
  const baseUserData = {
    email,
    passwordHash,
    role,
    fullName,
    phone,
    isActive: true,
    gender: profile.gender || null,
    dateOfBirth: nullableDate(profile.dateOfBirth),
    address: profile.address || null,
    language: profile.language || null,
    timeZone: profile.timeZone || null
  };
  const updateUserData = {
    ...baseUserData,
    doctorProfile: doctorProfile
      ? {
          upsert: {
            create: doctorProfile,
            update: doctorProfile
          }
        }
      : undefined,
    patientProfile: patientProfile
      ? {
          upsert: {
            create: patientProfile,
            update: patientProfile
          }
        }
      : undefined
  };
  const createUserData = {
    ...baseUserData,
    doctorProfile: doctorProfile ? { create: doctorProfile } : undefined,
    patientProfile: patientProfile ? { create: patientProfile } : undefined
  };

  return prisma.user.upsert({
    where: { email },
    update: updateUserData,
    create: {
      id,
      ...createUserData
    }
  });
}

async function seedUsers() {
  const users = {};
  for (const demoUser of DEMO_USERS) {
    // eslint-disable-next-line no-await-in-loop
    users[demoUser.email] = await upsertUser(demoUser);
  }
  return users;
}

async function seedFamilyMember() {
  return prisma.familyMember.upsert({
    where: { id: DEMO_IDS.familyMember },
    update: {
      ownerPatientId: DEMO_IDS.patientAsha,
      fullName: 'Sita Devi',
      relationToPatient: 'Mother',
      gender: 'female',
      dateOfBirth: date('1962-02-18T00:00:00.000Z'),
      chronicConditions: 'Arthritis',
      basicHealthInfo: 'Needs help reading medicine labels.'
    },
    create: {
      id: DEMO_IDS.familyMember,
      ownerPatientId: DEMO_IDS.patientAsha,
      fullName: 'Sita Devi',
      relationToPatient: 'Mother',
      gender: 'female',
      dateOfBirth: date('1962-02-18T00:00:00.000Z'),
      chronicConditions: 'Arthritis',
      basicHealthInfo: 'Needs help reading medicine labels.'
    }
  });
}

async function seedDoctorSlots() {
  const slotInputs = [
    [DEMO_IDS.doctorAsha, '2030-01-10T04:30:00.000Z'],
    [DEMO_IDS.doctorAsha, '2030-01-10T05:00:00.000Z'],
    [DEMO_IDS.doctorAsha, '2030-01-10T05:30:00.000Z'],
    [DEMO_IDS.doctorAsha, '2030-01-10T06:00:00.000Z'],
    [DEMO_IDS.doctorRavi, '2030-01-11T04:30:00.000Z'],
    [DEMO_IDS.doctorRavi, '2030-01-11T05:00:00.000Z'],
    [DEMO_IDS.doctorRavi, '2030-01-11T05:30:00.000Z'],
    [DEMO_IDS.doctorRavi, '2030-01-11T06:00:00.000Z']
  ];

  for (const [doctorId, startAtValue] of slotInputs) {
    const startAt = date(startAtValue);
    // eslint-disable-next-line no-await-in-loop
    await prisma.slot.upsert({
      where: { doctorId_startAt: { doctorId, startAt } },
      update: { status: 'available' },
      create: { doctorId, startAt, status: 'available' }
    });
  }
}

async function seedAppointments() {
  await prisma.appointment.upsert({
    where: { id: DEMO_IDS.completedAppointment },
    update: {
      patientId: DEMO_IDS.patientAsha,
      doctorId: DEMO_IDS.doctorAsha,
      familyMemberId: null,
      startAt: date('2026-05-01T04:30:00.000Z'),
      status: 'completed',
      mode: 'video',
      problemDescription: 'Follow-up for high blood pressure and mild wheezing.',
      medicationsText: 'Amlodipine 5mg daily; Salbutamol inhaler when needed',
      triageLevel: 'moderate',
      triageScore: 58
    },
    create: {
      id: DEMO_IDS.completedAppointment,
      patientId: DEMO_IDS.patientAsha,
      doctorId: DEMO_IDS.doctorAsha,
      familyMemberId: null,
      startAt: date('2026-05-01T04:30:00.000Z'),
      status: 'completed',
      mode: 'video',
      problemDescription: 'Follow-up for high blood pressure and mild wheezing.',
      medicationsText: 'Amlodipine 5mg daily; Salbutamol inhaler when needed',
      triageLevel: 'moderate',
      triageScore: 58
    }
  });

  await prisma.appointment.upsert({
    where: { id: DEMO_IDS.upcomingAppointment },
    update: {
      patientId: DEMO_IDS.patientRavi,
      doctorId: DEMO_IDS.doctorRavi,
      familyMemberId: DEMO_IDS.familyMember,
      startAt: date('2030-01-12T05:00:00.000Z'),
      status: 'booked',
      mode: 'audio',
      problemDescription: 'Itchy rash on both arms, worse after farm work.',
      medicationsText: 'Cetirizine as needed',
      triageLevel: 'low',
      triageScore: 22
    },
    create: {
      id: DEMO_IDS.upcomingAppointment,
      patientId: DEMO_IDS.patientRavi,
      doctorId: DEMO_IDS.doctorRavi,
      familyMemberId: DEMO_IDS.familyMember,
      startAt: date('2030-01-12T05:00:00.000Z'),
      status: 'booked',
      mode: 'audio',
      problemDescription: 'Itchy rash on both arms, worse after farm work.',
      medicationsText: 'Cetirizine as needed',
      triageLevel: 'low',
      triageScore: 22
    }
  });
}

async function seedClinicalRecords() {
  const prescriptionItems = [
    {
      name: 'Amlodipine',
      dosage: '5mg',
      frequency: 'Once daily after breakfast',
      duration: '30 days',
      sideEffects: 'Ankle swelling, dizziness'
    },
    {
      name: 'Salbutamol inhaler',
      dosage: '2 puffs',
      frequency: 'When wheezing',
      duration: 'As needed',
      sideEffects: 'Tremor, fast heartbeat'
    }
  ];

  await prisma.prescription.upsert({
    where: { appointmentId: DEMO_IDS.completedAppointment },
    update: {
      diagnosis: 'Hypertension with seasonal bronchospasm',
      items: prescriptionItems,
      instructions: 'Check BP twice weekly and avoid smoke exposure.',
      followUpAt: date('2030-01-15T04:30:00.000Z'),
      notes: 'Reviewed inhaler technique during consultation.',
      pharmacyName: 'Rampur Jan Aushadhi',
      pharmacyContact: '9999993001',
      handoffCode: 'DEMO-HANDOFF-ASH'
    },
    create: {
      id: DEMO_IDS.prescription,
      appointmentId: DEMO_IDS.completedAppointment,
      diagnosis: 'Hypertension with seasonal bronchospasm',
      items: prescriptionItems,
      instructions: 'Check BP twice weekly and avoid smoke exposure.',
      followUpAt: date('2030-01-15T04:30:00.000Z'),
      notes: 'Reviewed inhaler technique during consultation.',
      pharmacyName: 'Rampur Jan Aushadhi',
      pharmacyContact: '9999993001',
      handoffCode: 'DEMO-HANDOFF-ASH'
    }
  });

  await prisma.callSession.upsert({
    where: { appointmentId: DEMO_IDS.completedAppointment },
    update: {
      status: 'ended',
      startedAt: date('2026-05-01T04:30:00.000Z'),
      endedAt: date('2026-05-01T04:52:00.000Z')
    },
    create: {
      id: DEMO_IDS.callSession,
      appointmentId: DEMO_IDS.completedAppointment,
      status: 'ended',
      startedAt: date('2026-05-01T04:30:00.000Z'),
      endedAt: date('2026-05-01T04:52:00.000Z')
    }
  });

  await prisma.consultationVital.upsert({
    where: { id: DEMO_IDS.vital },
    update: {
      appointmentId: DEMO_IDS.completedAppointment,
      patientId: DEMO_IDS.patientAsha,
      recordedById: DEMO_IDS.doctorAsha,
      source: 'demo-seed',
      bpSystolic: 138,
      bpDiastolic: 88,
      temperatureC: 36.8,
      glucoseMgDl: 116,
      spo2Percent: 97,
      pulseBpm: 82,
      weightKg: 63.5,
      notes: 'Stable readings captured during demo consultation.'
    },
    create: {
      id: DEMO_IDS.vital,
      appointmentId: DEMO_IDS.completedAppointment,
      patientId: DEMO_IDS.patientAsha,
      recordedById: DEMO_IDS.doctorAsha,
      source: 'demo-seed',
      bpSystolic: 138,
      bpDiastolic: 88,
      temperatureC: 36.8,
      glucoseMgDl: 116,
      spo2Percent: 97,
      pulseBpm: 82,
      weightKg: 63.5,
      notes: 'Stable readings captured during demo consultation.'
    }
  });

  await prisma.doctorReview.upsert({
    where: { appointmentId: DEMO_IDS.completedAppointment },
    update: {
      doctorId: DEMO_IDS.doctorAsha,
      patientId: DEMO_IDS.patientAsha,
      rating: 5,
      comment: 'Clear advice and easy follow-up instructions.'
    },
    create: {
      id: DEMO_IDS.doctorReview,
      appointmentId: DEMO_IDS.completedAppointment,
      doctorId: DEMO_IDS.doctorAsha,
      patientId: DEMO_IDS.patientAsha,
      rating: 5,
      comment: 'Clear advice and easy follow-up instructions.'
    }
  });
}

async function seedOperations() {
  await prisma.labTestCatalog.createMany({
    data: DEMO_LAB_CATALOG,
    skipDuplicates: true
  });

  const hba1c = await prisma.labTestCatalog.findUnique({ where: { code: 'HBA1C' } });

  await prisma.pharmacyOrder.upsert({
    where: { id: DEMO_IDS.pharmacyOrder },
    update: {
      patientId: DEMO_IDS.patientAsha,
      appointmentId: DEMO_IDS.completedAppointment,
      prescriptionId: DEMO_IDS.prescription,
      placedById: DEMO_IDS.patientAsha,
      pharmacyName: 'Rampur Jan Aushadhi',
      pharmacyContact: '9999993001',
      handoffCode: 'DEMO-HANDOFF-ASH',
      deliveryAddress: 'Village Rampur, near primary school',
      notes: 'Deliver after 5 PM when family is home.',
      status: 'processing',
      items: [
        { name: 'Amlodipine', dosage: '5mg', frequency: 'Once daily', duration: '30 days', quantity: 30 },
        { name: 'Salbutamol inhaler', dosage: '2 puffs', frequency: 'SOS', duration: '1 unit', quantity: 1 }
      ]
    },
    create: {
      id: DEMO_IDS.pharmacyOrder,
      patientId: DEMO_IDS.patientAsha,
      appointmentId: DEMO_IDS.completedAppointment,
      prescriptionId: DEMO_IDS.prescription,
      placedById: DEMO_IDS.patientAsha,
      pharmacyName: 'Rampur Jan Aushadhi',
      pharmacyContact: '9999993001',
      handoffCode: 'DEMO-HANDOFF-ASH',
      deliveryAddress: 'Village Rampur, near primary school',
      notes: 'Deliver after 5 PM when family is home.',
      status: 'processing',
      items: [
        { name: 'Amlodipine', dosage: '5mg', frequency: 'Once daily', duration: '30 days', quantity: 30 },
        { name: 'Salbutamol inhaler', dosage: '2 puffs', frequency: 'SOS', duration: '1 unit', quantity: 1 }
      ]
    }
  });

  await prisma.labOrder.upsert({
    where: { id: DEMO_IDS.labOrder },
    update: {
      patientId: DEMO_IDS.patientRavi,
      appointmentId: DEMO_IDS.upcomingAppointment,
      orderedByDoctorId: DEMO_IDS.doctorRavi,
      familyMemberId: null,
      status: 'sample_collected',
      clinicalNotes: 'Baseline diabetes follow-up before dermatology consult.'
    },
    create: {
      id: DEMO_IDS.labOrder,
      patientId: DEMO_IDS.patientRavi,
      appointmentId: DEMO_IDS.upcomingAppointment,
      orderedByDoctorId: DEMO_IDS.doctorRavi,
      familyMemberId: null,
      status: 'sample_collected',
      clinicalNotes: 'Baseline diabetes follow-up before dermatology consult.'
    }
  });

  await prisma.labOrderItem.upsert({
    where: { id: DEMO_IDS.labOrderItem },
    update: {
      labOrderId: DEMO_IDS.labOrder,
      catalogTestId: hba1c?.id || null,
      testName: 'HbA1c',
      sampleType: 'Blood',
      instructions: 'No fasting required.',
      priceCents: 75000
    },
    create: {
      id: DEMO_IDS.labOrderItem,
      labOrderId: DEMO_IDS.labOrder,
      catalogTestId: hba1c?.id || null,
      testName: 'HbA1c',
      sampleType: 'Blood',
      instructions: 'No fasting required.',
      priceCents: 75000
    }
  });

  await prisma.reminderJob.upsert({
    where: { id: DEMO_IDS.reminder },
    update: {
      appointmentId: DEMO_IDS.upcomingAppointment,
      patientId: DEMO_IDS.patientRavi,
      channel: 'whatsapp',
      sendAt: date('2030-01-11T05:00:00.000Z'),
      templateKey: 'appointment_reminder',
      payload: { doctorName: 'Dr. Ravi Singh', mode: 'audio' },
      status: 'scheduled',
      attempts: 0,
      sentAt: null,
      failedAt: null,
      lastError: null
    },
    create: {
      id: DEMO_IDS.reminder,
      appointmentId: DEMO_IDS.upcomingAppointment,
      patientId: DEMO_IDS.patientRavi,
      channel: 'whatsapp',
      sendAt: date('2030-01-11T05:00:00.000Z'),
      templateKey: 'appointment_reminder',
      payload: { doctorName: 'Dr. Ravi Singh', mode: 'audio' },
      status: 'scheduled',
      attempts: 0
    }
  });
}

async function seedSupportAndInnovation() {
  await prisma.careSupportLink.upsert({
    where: { id: DEMO_IDS.supportLink },
    update: {
      patientId: DEMO_IDS.patientAsha,
      createdById: DEMO_IDS.patientAsha,
      helperName: 'Meena Verma',
      helperPhone: '9999992001',
      relationToPatient: 'ASHA worker',
      village: 'Rampur',
      notes: 'Helps patient join calls and understand prescriptions.',
      isActive: true
    },
    create: {
      id: DEMO_IDS.supportLink,
      patientId: DEMO_IDS.patientAsha,
      createdById: DEMO_IDS.patientAsha,
      helperName: 'Meena Verma',
      helperPhone: '9999992001',
      relationToPatient: 'ASHA worker',
      village: 'Rampur',
      notes: 'Helps patient join calls and understand prescriptions.',
      isActive: true
    }
  });

  await prisma.consentAudit.upsert({
    where: { id: DEMO_IDS.consentAudit },
    update: {
      patientId: DEMO_IDS.patientAsha,
      helperId: DEMO_IDS.supportLink,
      appointmentId: DEMO_IDS.completedAppointment,
      scope: 'all',
      action: 'granted',
      notes: 'Demo consent for assisted telemedicine workflows.',
      isActive: true,
      revokedAt: null,
      grantedById: DEMO_IDS.patientAsha
    },
    create: {
      id: DEMO_IDS.consentAudit,
      patientId: DEMO_IDS.patientAsha,
      helperId: DEMO_IDS.supportLink,
      appointmentId: DEMO_IDS.completedAppointment,
      scope: 'all',
      action: 'granted',
      notes: 'Demo consent for assisted telemedicine workflows.',
      isActive: true,
      grantedById: DEMO_IDS.patientAsha
    }
  });

  await prisma.patientAccessToken.upsert({
    where: { token: 'demo-asha-share-token' },
    update: {
      patientId: DEMO_IDS.patientAsha,
      createdById: DEMO_IDS.patientAsha,
      label: 'Demo QR access for Asha Devi',
      expiresAt: date('2031-01-01T00:00:00.000Z'),
      revokedAt: null
    },
    create: {
      id: DEMO_IDS.patientToken,
      token: 'demo-asha-share-token',
      patientId: DEMO_IDS.patientAsha,
      createdById: DEMO_IDS.patientAsha,
      label: 'Demo QR access for Asha Devi',
      expiresAt: date('2031-01-01T00:00:00.000Z')
    }
  });

  await prisma.chronicCarePlan.upsert({
    where: { id: DEMO_IDS.chronicPlan },
    update: {
      patientId: DEMO_IDS.patientAsha,
      createdById: DEMO_IDS.doctorAsha,
      familyMemberId: null,
      condition: 'Hypertension',
      status: 'active',
      startAt: date('2026-05-01T00:00:00.000Z'),
      nextCheckInAt: date('2030-01-15T04:30:00.000Z'),
      checkInIntervalDays: 30,
      milestones: ['Weekly BP log', 'Reduce salt intake', 'Follow-up after 30 days'],
      notes: 'Demo chronic pathway for rural follow-up.'
    },
    create: {
      id: DEMO_IDS.chronicPlan,
      patientId: DEMO_IDS.patientAsha,
      createdById: DEMO_IDS.doctorAsha,
      familyMemberId: null,
      condition: 'Hypertension',
      status: 'active',
      startAt: date('2026-05-01T00:00:00.000Z'),
      nextCheckInAt: date('2030-01-15T04:30:00.000Z'),
      checkInIntervalDays: 30,
      milestones: ['Weekly BP log', 'Reduce salt intake', 'Follow-up after 30 days'],
      notes: 'Demo chronic pathway for rural follow-up.'
    }
  });

  await prisma.carePlanCheckIn.upsert({
    where: { id: DEMO_IDS.carePlanCheckIn },
    update: {
      planId: DEMO_IDS.chronicPlan,
      appointmentId: DEMO_IDS.completedAppointment,
      scheduledAt: date('2030-01-15T04:30:00.000Z'),
      completedAt: null,
      status: 'scheduled',
      notes: 'Review BP log and inhaler use.',
      vitalsSnapshot: { bpSystolic: 138, bpDiastolic: 88, spo2Percent: 97 }
    },
    create: {
      id: DEMO_IDS.carePlanCheckIn,
      planId: DEMO_IDS.chronicPlan,
      appointmentId: DEMO_IDS.completedAppointment,
      scheduledAt: date('2030-01-15T04:30:00.000Z'),
      status: 'scheduled',
      notes: 'Review BP log and inhaler use.',
      vitalsSnapshot: { bpSystolic: 138, bpDiastolic: 88, spo2Percent: 97 }
    }
  });
}

async function main() {
  await seedUsers();
  await seedFamilyMember();
  await seedDoctorSlots();
  await seedAppointments();
  await seedClinicalRecords();
  await seedOperations();
  await seedSupportAndInnovation();
}

main()
  .then(async () => {
    await prisma.$disconnect();
    // eslint-disable-next-line no-console
    console.log('Seed complete. Demo password for seeded accounts: Demo@12345');
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

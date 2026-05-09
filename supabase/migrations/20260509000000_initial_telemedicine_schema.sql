-- Supabase initial schema generated from existing Prisma migrations.
-- Run in a fresh Supabase project database.

-- Source: prisma\migrations\20260329000100_baseline\migration.sql
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('patient', 'doctor', 'admin', 'help_worker');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('available', 'busy', 'booked');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('booked', 'completed', 'cancelled', 'no_show');

-- CreateEnum
CREATE TYPE "ConsultationMode" AS ENUM ('video', 'audio', 'text');

-- CreateEnum
CREATE TYPE "CallSessionStatus" AS ENUM ('ready', 'in_progress', 'ended', 'failed');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('sms', 'whatsapp');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('scheduled', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "DelegationScope" AS ENUM ('appointment', 'records', 'all');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "address" TEXT,
    "language" TEXT,
    "timeZone" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientProfile" (
    "userId" TEXT NOT NULL,
    "chronicConditions" TEXT,
    "basicHealthInfo" TEXT,

    CONSTRAINT "PatientProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "DoctorProfile" (
    "userId" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "yearsOfExperience" INTEGER,
    "qualifications" TEXT,
    "clinicName" TEXT,
    "consultationLanguages" TEXT,
    "description" TEXT,
    "callEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DoctorProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Slot" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "doctorId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'available',

    CONSTRAINT "Slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "familyMemberId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'booked',
    "mode" "ConsultationMode" NOT NULL DEFAULT 'video',
    "problemDescription" TEXT,
    "medicationsText" TEXT,
    "slotId" TEXT,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FamilyMember" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerPatientId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "relationToPatient" TEXT,
    "gender" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "chronicConditions" TEXT,
    "basicHealthInfo" TEXT,

    CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSession" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "status" "CallSessionStatus" NOT NULL DEFAULT 'ready',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "CallSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT NOT NULL,
    "familyMemberId" TEXT,
    "appointmentId" TEXT,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "blobName" TEXT NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "diagnosis" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "instructions" TEXT,
    "followUpAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorReview" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,

    CONSTRAINT "DoctorReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderJob" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "channel" "ReminderChannel" NOT NULL DEFAULT 'sms',
    "sendAt" TIMESTAMP(3) NOT NULL,
    "templateKey" TEXT NOT NULL,
    "payload" JSONB,
    "status" "ReminderStatus" NOT NULL DEFAULT 'scheduled',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "ReminderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CareSupportLink" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "patientId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "helperName" TEXT NOT NULL,
    "helperPhone" TEXT NOT NULL,
    "relationToPatient" TEXT,
    "village" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CareSupportLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentAudit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "patientId" TEXT NOT NULL,
    "helperId" TEXT,
    "appointmentId" TEXT,
    "scope" "DelegationScope" NOT NULL DEFAULT 'appointment',
    "action" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "revokedAt" TIMESTAMP(3),
    "grantedById" TEXT NOT NULL,

    CONSTRAINT "ConsentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Slot_doctorId_startAt_idx" ON "Slot"("doctorId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Slot_doctorId_startAt_key" ON "Slot"("doctorId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Appointment_slotId_key" ON "Appointment"("slotId");

-- CreateIndex
CREATE INDEX "Appointment_doctorId_startAt_idx" ON "Appointment"("doctorId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_patientId_startAt_idx" ON "Appointment"("patientId", "startAt");

-- CreateIndex
CREATE INDEX "Appointment_familyMemberId_idx" ON "Appointment"("familyMemberId");

-- CreateIndex
CREATE INDEX "FamilyMember_ownerPatientId_fullName_idx" ON "FamilyMember"("ownerPatientId", "fullName");

-- CreateIndex
CREATE UNIQUE INDEX "CallSession_appointmentId_key" ON "CallSession"("appointmentId");

-- CreateIndex
CREATE INDEX "Document_ownerId_appointmentId_familyMemberId_idx" ON "Document"("ownerId", "appointmentId", "familyMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_appointmentId_key" ON "Prescription"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorReview_appointmentId_key" ON "DoctorReview"("appointmentId");

-- CreateIndex
CREATE INDEX "DoctorReview_doctorId_createdAt_idx" ON "DoctorReview"("doctorId", "createdAt");

-- CreateIndex
CREATE INDEX "DoctorReview_patientId_createdAt_idx" ON "DoctorReview"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "ReminderJob_status_sendAt_idx" ON "ReminderJob"("status", "sendAt");

-- CreateIndex
CREATE INDEX "ReminderJob_patientId_sendAt_idx" ON "ReminderJob"("patientId", "sendAt");

-- CreateIndex
CREATE INDEX "ReminderJob_appointmentId_sendAt_idx" ON "ReminderJob"("appointmentId", "sendAt");

-- CreateIndex
CREATE INDEX "CareSupportLink_patientId_helperName_idx" ON "CareSupportLink"("patientId", "helperName");

-- CreateIndex
CREATE INDEX "CareSupportLink_patientId_isActive_idx" ON "CareSupportLink"("patientId", "isActive");

-- CreateIndex
CREATE INDEX "ConsentAudit_patientId_createdAt_idx" ON "ConsentAudit"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsentAudit_appointmentId_idx" ON "ConsentAudit"("appointmentId");

-- CreateIndex
CREATE INDEX "ConsentAudit_isActive_scope_idx" ON "ConsentAudit"("isActive", "scope");

-- AddForeignKey
ALTER TABLE "PatientProfile" ADD CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorProfile" ADD CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Slot" ADD CONSTRAINT "Slot_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_ownerPatientId_fkey" FOREIGN KEY ("ownerPatientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSession" ADD CONSTRAINT "CallSession_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorReview" ADD CONSTRAINT "DoctorReview_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorReview" ADD CONSTRAINT "DoctorReview_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorReview" ADD CONSTRAINT "DoctorReview_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderJob" ADD CONSTRAINT "ReminderJob_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderJob" ADD CONSTRAINT "ReminderJob_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareSupportLink" ADD CONSTRAINT "CareSupportLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareSupportLink" ADD CONSTRAINT "CareSupportLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAudit" ADD CONSTRAINT "ConsentAudit_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAudit" ADD CONSTRAINT "ConsentAudit_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "CareSupportLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAudit" ADD CONSTRAINT "ConsentAudit_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAudit" ADD CONSTRAINT "ConsentAudit_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Source: prisma\migrations\20260329000200_structured_triage_handoff\migration.sql
-- CreateEnum
CREATE TYPE "TriageLevel" AS ENUM ('unknown', 'low', 'moderate', 'high', 'critical');

-- AlterTable
ALTER TABLE "Appointment"
ADD COLUMN "triageLevel" "TriageLevel" NOT NULL DEFAULT 'unknown',
ADD COLUMN "triageScore" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Prescription"
ADD COLUMN "pharmacyName" TEXT,
ADD COLUMN "pharmacyContact" TEXT,
ADD COLUMN "handoffCode" TEXT;

-- Backfill handoff code for existing prescriptions
UPDATE "Prescription"
SET "handoffCode" = 'RX-' || UPPER(SPLIT_PART("appointmentId", '-', 1))
WHERE "handoffCode" IS NULL;

-- CreateIndex
CREATE INDEX "Appointment_triageLevel_idx" ON "Appointment"("triageLevel");

-- CreateIndex
CREATE INDEX "Prescription_handoffCode_idx" ON "Prescription"("handoffCode");


-- Source: prisma\migrations\20260331000100_pharmacy_lab_workflows\migration.sql
-- CreateEnum
CREATE TYPE "PharmacyOrderStatus" AS ENUM ('placed', 'processing', 'ready', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "LabOrderStatus" AS ENUM ('requested', 'sample_collected', 'processing', 'report_ready', 'completed', 'cancelled');

-- CreateTable
CREATE TABLE "PharmacyOrder" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "prescriptionId" TEXT,
    "placedById" TEXT NOT NULL,
    "pharmacyName" TEXT,
    "pharmacyContact" TEXT,
    "handoffCode" TEXT,
    "deliveryAddress" TEXT,
    "notes" TEXT,
    "status" "PharmacyOrderStatus" NOT NULL DEFAULT 'placed',
    "items" JSONB NOT NULL,

    CONSTRAINT "PharmacyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabTestCatalog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "sampleType" TEXT,
    "fastingRequired" BOOLEAN NOT NULL DEFAULT false,
    "turnaroundHours" INTEGER,
    "priceCents" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LabTestCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrder" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "patientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "orderedByDoctorId" TEXT,
    "familyMemberId" TEXT,
    "reportDocumentId" TEXT,
    "status" "LabOrderStatus" NOT NULL DEFAULT 'requested',
    "clinicalNotes" TEXT,

    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabOrderItem" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "labOrderId" TEXT NOT NULL,
    "catalogTestId" TEXT,
    "testName" TEXT NOT NULL,
    "sampleType" TEXT,
    "instructions" TEXT,
    "priceCents" INTEGER,

    CONSTRAINT "LabOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PharmacyOrder_patientId_createdAt_idx" ON "PharmacyOrder"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "PharmacyOrder_appointmentId_idx" ON "PharmacyOrder"("appointmentId");

-- CreateIndex
CREATE INDEX "PharmacyOrder_prescriptionId_idx" ON "PharmacyOrder"("prescriptionId");

-- CreateIndex
CREATE INDEX "PharmacyOrder_status_createdAt_idx" ON "PharmacyOrder"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LabTestCatalog_code_key" ON "LabTestCatalog"("code");

-- CreateIndex
CREATE INDEX "LabTestCatalog_isActive_category_idx" ON "LabTestCatalog"("isActive", "category");

-- CreateIndex
CREATE UNIQUE INDEX "LabOrder_reportDocumentId_key" ON "LabOrder"("reportDocumentId");

-- CreateIndex
CREATE INDEX "LabOrder_patientId_createdAt_idx" ON "LabOrder"("patientId", "createdAt");

-- CreateIndex
CREATE INDEX "LabOrder_appointmentId_idx" ON "LabOrder"("appointmentId");

-- CreateIndex
CREATE INDEX "LabOrder_orderedByDoctorId_idx" ON "LabOrder"("orderedByDoctorId");

-- CreateIndex
CREATE INDEX "LabOrder_familyMemberId_idx" ON "LabOrder"("familyMemberId");

-- CreateIndex
CREATE INDEX "LabOrder_status_createdAt_idx" ON "LabOrder"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LabOrderItem_labOrderId_idx" ON "LabOrderItem"("labOrderId");

-- CreateIndex
CREATE INDEX "LabOrderItem_catalogTestId_idx" ON "LabOrderItem"("catalogTestId");

-- AddForeignKey
ALTER TABLE "PharmacyOrder" ADD CONSTRAINT "PharmacyOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyOrder" ADD CONSTRAINT "PharmacyOrder_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyOrder" ADD CONSTRAINT "PharmacyOrder_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PharmacyOrder" ADD CONSTRAINT "PharmacyOrder_placedById_fkey" FOREIGN KEY ("placedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_orderedByDoctorId_fkey" FOREIGN KEY ("orderedByDoctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_reportDocumentId_fkey" FOREIGN KEY ("reportDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "LabOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabOrderItem" ADD CONSTRAINT "LabOrderItem_catalogTestId_fkey" FOREIGN KEY ("catalogTestId") REFERENCES "LabTestCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Source: prisma\migrations\20260331133000_innovation_features\migration.sql
-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('open', 'accepted', 'closed', 'rejected');

-- CreateEnum
CREATE TYPE "ExternalConsultChannel" AS ENUM ('sms', 'whatsapp');

-- CreateEnum
CREATE TYPE "ExternalMessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "ChronicCarePlanStatus" AS ENUM ('active', 'paused', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "CommunitySessionStatus" AS ENUM ('scheduled', 'live', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "EmergencyStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "SecondOpinionStatus" AS ENUM ('requested', 'accepted', 'completed', 'declined');

-- AlterTable
ALTER TABLE "PatientProfile"
  ADD COLUMN "abhaId" TEXT,
  ADD COLUMN "abhaAddress" TEXT,
  ADD COLUMN "abhaLinkedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Appointment"
  ADD COLUMN "caseRootAppointmentId" TEXT,
  ADD COLUMN "referredFromAppointmentId" TEXT;

-- CreateTable
CREATE TABLE "ConsultationVital" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "recordedById" TEXT NOT NULL,
  "source" TEXT,
  "bpSystolic" INTEGER,
  "bpDiastolic" INTEGER,
  "temperatureC" DOUBLE PRECISION,
  "glucoseMgDl" DOUBLE PRECISION,
  "spo2Percent" INTEGER,
  "pulseBpm" INTEGER,
  "weightKg" DOUBLE PRECISION,
  "notes" TEXT,
  CONSTRAINT "ConsultationVital_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "fromAppointmentId" TEXT NOT NULL,
  "toAppointmentId" TEXT,
  "patientId" TEXT NOT NULL,
  "familyMemberId" TEXT,
  "createdById" TEXT NOT NULL,
  "fromDoctorId" TEXT,
  "toDoctorId" TEXT,
  "targetSpecialization" TEXT,
  "reason" TEXT NOT NULL,
  "status" "ReferralStatus" NOT NULL DEFAULT 'open',
  "continuitySnapshot" JSONB,
  CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientAccessToken" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "token" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "label" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  CONSTRAINT "PatientAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChronicCarePlan" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "patientId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "familyMemberId" TEXT,
  "condition" TEXT NOT NULL,
  "status" "ChronicCarePlanStatus" NOT NULL DEFAULT 'active',
  "startAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextCheckInAt" TIMESTAMP(3),
  "checkInIntervalDays" INTEGER NOT NULL DEFAULT 30,
  "milestones" JSONB,
  "notes" TEXT,
  CONSTRAINT "ChronicCarePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarePlanCheckIn" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "planId" TEXT NOT NULL,
  "appointmentId" TEXT,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "notes" TEXT,
  "vitalsSnapshot" JSONB,
  CONSTRAINT "CarePlanCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyEscalation" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "patientId" TEXT NOT NULL,
  "triggeredById" TEXT NOT NULL,
  "appointmentId" TEXT,
  "locationLat" DOUBLE PRECISION,
  "locationLng" DOUBLE PRECISION,
  "locationText" TEXT,
  "contactName" TEXT,
  "contactPhone" TEXT,
  "medicalSummary" TEXT,
  "latestVitals" JSONB,
  "status" "EmergencyStatus" NOT NULL DEFAULT 'open',
  CONSTRAINT "EmergencyEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunitySession" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "doctorId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "village" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "status" "CommunitySessionStatus" NOT NULL DEFAULT 'scheduled',
  "notes" TEXT,
  CONSTRAINT "CommunitySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunitySessionParticipant" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sessionId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "familyMemberId" TEXT,
  "joinedByUserId" TEXT,
  "followUpAppointmentId" TEXT,
  "notes" TEXT,
  CONSTRAINT "CommunitySessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalConsultThread" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "channel" "ExternalConsultChannel" NOT NULL DEFAULT 'whatsapp',
  "contactPhone" TEXT,
  "lastMessageAt" TIMESTAMP(3),
  CONSTRAINT "ExternalConsultThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalConsultMessage" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "threadId" TEXT NOT NULL,
  "direction" "ExternalMessageDirection" NOT NULL,
  "body" TEXT NOT NULL,
  "syncedById" TEXT,
  "deliveryStatus" TEXT,
  "metadata" JSONB,
  CONSTRAINT "ExternalConsultMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationVoiceNote" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "doctorId" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'en',
  "transcriptText" TEXT NOT NULL,
  "summaryText" TEXT,
  "audioBlobName" TEXT,
  "source" TEXT,
  CONSTRAINT "ConsultationVoiceNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondOpinionRequest" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "patientId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "appointmentId" TEXT NOT NULL,
  "secondDoctorId" TEXT,
  "status" "SecondOpinionStatus" NOT NULL DEFAULT 'requested',
  "consentNote" TEXT,
  "consentGrantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewSummary" TEXT,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "SecondOpinionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondOpinionAudit" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "notes" TEXT,
  CONSTRAINT "SecondOpinionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PatientProfile_abhaId_key" ON "PatientProfile"("abhaId");

-- CreateIndex
CREATE INDEX "Appointment_caseRootAppointmentId_idx" ON "Appointment"("caseRootAppointmentId");

-- CreateIndex
CREATE INDEX "Appointment_referredFromAppointmentId_idx" ON "Appointment"("referredFromAppointmentId");

-- CreateIndex
CREATE INDEX "ConsultationVital_appointmentId_createdAt_idx" ON "ConsultationVital"("appointmentId", "createdAt");
CREATE INDEX "ConsultationVital_patientId_createdAt_idx" ON "ConsultationVital"("patientId", "createdAt");
CREATE INDEX "ConsultationVital_recordedById_createdAt_idx" ON "ConsultationVital"("recordedById", "createdAt");

-- CreateIndex
CREATE INDEX "Referral_patientId_createdAt_idx" ON "Referral"("patientId", "createdAt");
CREATE INDEX "Referral_fromAppointmentId_createdAt_idx" ON "Referral"("fromAppointmentId", "createdAt");
CREATE INDEX "Referral_toAppointmentId_idx" ON "Referral"("toAppointmentId");
CREATE INDEX "Referral_status_createdAt_idx" ON "Referral"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientAccessToken_token_key" ON "PatientAccessToken"("token");
CREATE INDEX "PatientAccessToken_patientId_expiresAt_idx" ON "PatientAccessToken"("patientId", "expiresAt");
CREATE INDEX "PatientAccessToken_expiresAt_idx" ON "PatientAccessToken"("expiresAt");

-- CreateIndex
CREATE INDEX "ChronicCarePlan_patientId_status_nextCheckInAt_idx" ON "ChronicCarePlan"("patientId", "status", "nextCheckInAt");
CREATE INDEX "ChronicCarePlan_familyMemberId_idx" ON "ChronicCarePlan"("familyMemberId");

-- CreateIndex
CREATE INDEX "CarePlanCheckIn_planId_scheduledAt_idx" ON "CarePlanCheckIn"("planId", "scheduledAt");
CREATE INDEX "CarePlanCheckIn_appointmentId_idx" ON "CarePlanCheckIn"("appointmentId");

-- CreateIndex
CREATE INDEX "EmergencyEscalation_patientId_status_createdAt_idx" ON "EmergencyEscalation"("patientId", "status", "createdAt");
CREATE INDEX "EmergencyEscalation_appointmentId_idx" ON "EmergencyEscalation"("appointmentId");

-- CreateIndex
CREATE INDEX "CommunitySession_doctorId_startsAt_idx" ON "CommunitySession"("doctorId", "startsAt");
CREATE INDEX "CommunitySession_status_startsAt_idx" ON "CommunitySession"("status", "startsAt");

-- CreateIndex
CREATE INDEX "CommunitySessionParticipant_sessionId_createdAt_idx" ON "CommunitySessionParticipant"("sessionId", "createdAt");
CREATE INDEX "CommunitySessionParticipant_patientId_idx" ON "CommunitySessionParticipant"("patientId");
CREATE INDEX "CommunitySessionParticipant_familyMemberId_idx" ON "CommunitySessionParticipant"("familyMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalConsultThread_appointmentId_key" ON "ExternalConsultThread"("appointmentId");
CREATE INDEX "ExternalConsultThread_patientId_lastMessageAt_idx" ON "ExternalConsultThread"("patientId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ExternalConsultMessage_threadId_createdAt_idx" ON "ExternalConsultMessage"("threadId", "createdAt");
CREATE INDEX "ExternalConsultMessage_syncedById_idx" ON "ExternalConsultMessage"("syncedById");

-- CreateIndex
CREATE INDEX "ConsultationVoiceNote_appointmentId_createdAt_idx" ON "ConsultationVoiceNote"("appointmentId", "createdAt");
CREATE INDEX "ConsultationVoiceNote_doctorId_createdAt_idx" ON "ConsultationVoiceNote"("doctorId", "createdAt");

-- CreateIndex
CREATE INDEX "SecondOpinionRequest_patientId_status_createdAt_idx" ON "SecondOpinionRequest"("patientId", "status", "createdAt");
CREATE INDEX "SecondOpinionRequest_appointmentId_idx" ON "SecondOpinionRequest"("appointmentId");
CREATE INDEX "SecondOpinionRequest_secondDoctorId_idx" ON "SecondOpinionRequest"("secondDoctorId");

-- CreateIndex
CREATE INDEX "SecondOpinionAudit_requestId_createdAt_idx" ON "SecondOpinionAudit"("requestId", "createdAt");
CREATE INDEX "SecondOpinionAudit_actorId_createdAt_idx" ON "SecondOpinionAudit"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_caseRootAppointmentId_fkey" FOREIGN KEY ("caseRootAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_referredFromAppointmentId_fkey" FOREIGN KEY ("referredFromAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConsultationVital" ADD CONSTRAINT "ConsultationVital_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultationVital" ADD CONSTRAINT "ConsultationVital_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultationVital" ADD CONSTRAINT "ConsultationVital_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Referral" ADD CONSTRAINT "Referral_fromAppointmentId_fkey" FOREIGN KEY ("fromAppointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_toAppointmentId_fkey" FOREIGN KEY ("toAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientAccessToken" ADD CONSTRAINT "PatientAccessToken_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PatientAccessToken" ADD CONSTRAINT "PatientAccessToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChronicCarePlan" ADD CONSTRAINT "ChronicCarePlan_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChronicCarePlan" ADD CONSTRAINT "ChronicCarePlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChronicCarePlan" ADD CONSTRAINT "ChronicCarePlan_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CarePlanCheckIn" ADD CONSTRAINT "CarePlanCheckIn_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ChronicCarePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CarePlanCheckIn" ADD CONSTRAINT "CarePlanCheckIn_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EmergencyEscalation" ADD CONSTRAINT "EmergencyEscalation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyEscalation" ADD CONSTRAINT "EmergencyEscalation_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmergencyEscalation" ADD CONSTRAINT "EmergencyEscalation_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommunitySession" ADD CONSTRAINT "CommunitySession_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunitySessionParticipant" ADD CONSTRAINT "CommunitySessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CommunitySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunitySessionParticipant" ADD CONSTRAINT "CommunitySessionParticipant_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunitySessionParticipant" ADD CONSTRAINT "CommunitySessionParticipant_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "FamilyMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunitySessionParticipant" ADD CONSTRAINT "CommunitySessionParticipant_joinedByUserId_fkey" FOREIGN KEY ("joinedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CommunitySessionParticipant" ADD CONSTRAINT "CommunitySessionParticipant_followUpAppointmentId_fkey" FOREIGN KEY ("followUpAppointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ExternalConsultThread" ADD CONSTRAINT "ExternalConsultThread_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalConsultThread" ADD CONSTRAINT "ExternalConsultThread_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalConsultMessage" ADD CONSTRAINT "ExternalConsultMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ExternalConsultThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalConsultMessage" ADD CONSTRAINT "ExternalConsultMessage_syncedById_fkey" FOREIGN KEY ("syncedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConsultationVoiceNote" ADD CONSTRAINT "ConsultationVoiceNote_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultationVoiceNote" ADD CONSTRAINT "ConsultationVoiceNote_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SecondOpinionRequest" ADD CONSTRAINT "SecondOpinionRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecondOpinionRequest" ADD CONSTRAINT "SecondOpinionRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecondOpinionRequest" ADD CONSTRAINT "SecondOpinionRequest_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecondOpinionRequest" ADD CONSTRAINT "SecondOpinionRequest_secondDoctorId_fkey" FOREIGN KEY ("secondDoctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SecondOpinionAudit" ADD CONSTRAINT "SecondOpinionAudit_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SecondOpinionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecondOpinionAudit" ADD CONSTRAINT "SecondOpinionAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Source: prisma\migrations\20260404000100_doctor_status_message\migration.sql
-- AlterTable
ALTER TABLE "DoctorProfile"
  ADD COLUMN "statusMessage" TEXT;

-- Supabase compatibility helpers and conservative RLS starter policies.
-- The first migration preserves the Prisma table names so the existing app logic
-- can run against Supabase Postgres while route-by-route migration continues.

CREATE OR REPLACE FUNCTION public.telemedicine_current_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT (SELECT auth.uid())::TEXT;
$$;

CREATE OR REPLACE FUNCTION public.telemedicine_current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT "role"::TEXT
  FROM public."User"
  WHERE "id" = public.telemedicine_current_user_id()
    AND "isActive" = TRUE;
$$;

CREATE OR REPLACE FUNCTION public.telemedicine_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(public.telemedicine_current_user_role() = 'admin', FALSE);
$$;

CREATE OR REPLACE FUNCTION public.telemedicine_is_care_helper_for(patient_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."CareSupportLink" link
    JOIN public."ConsentAudit" consent
      ON consent."helperId" = link."id"
    WHERE link."createdById" = public.telemedicine_current_user_id()
      AND link."patientId" = patient_id
      AND link."isActive" = TRUE
      AND consent."isActive" = TRUE
  );
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'User',
    'PatientProfile',
    'DoctorProfile',
    'Slot',
    'Appointment',
    'FamilyMember',
    'CallSession',
    'Document',
    'Prescription',
    'DoctorReview',
    'ReminderJob',
    'CareSupportLink',
    'ConsentAudit',
    'PharmacyOrder',
    'LabTestCatalog',
    'LabOrder',
    'LabOrderItem',
    'ConsultationVital',
    'Referral',
    'PatientAccessToken',
    'ChronicCarePlan',
    'CarePlanCheckIn',
    'EmergencyEscalation',
    'CommunitySession',
    'CommunitySessionParticipant',
    'ExternalConsultThread',
    'ExternalConsultMessage',
    'ConsultationVoiceNote',
    'SecondOpinionRequest',
    'SecondOpinionAudit'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I enable row level security', table_name);
  END LOOP;
END $$;

CREATE POLICY "Users can read self or admins can read all"
ON public."User"
FOR SELECT
TO authenticated
USING ("id" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin());

CREATE POLICY "Users can update self or admins can update all"
ON public."User"
FOR UPDATE
TO authenticated
USING ("id" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin())
WITH CHECK ("id" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin());

CREATE POLICY "Patients can read own patient profile"
ON public."PatientProfile"
FOR SELECT
TO authenticated
USING ("userId" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin());

CREATE POLICY "Doctors can read public doctor profiles"
ON public."DoctorProfile"
FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY "Doctors can update own doctor profile"
ON public."DoctorProfile"
FOR UPDATE
TO authenticated
USING ("userId" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin())
WITH CHECK ("userId" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin());

CREATE POLICY "Appointment participants can read appointments"
ON public."Appointment"
FOR SELECT
TO authenticated
USING (
  "patientId" = public.telemedicine_current_user_id()
  OR "doctorId" = public.telemedicine_current_user_id()
  OR public.telemedicine_is_care_helper_for("patientId")
  OR public.telemedicine_is_admin()
);

CREATE POLICY "Appointment participants can update appointments"
ON public."Appointment"
FOR UPDATE
TO authenticated
USING (
  "patientId" = public.telemedicine_current_user_id()
  OR "doctorId" = public.telemedicine_current_user_id()
  OR public.telemedicine_is_admin()
)
WITH CHECK (
  "patientId" = public.telemedicine_current_user_id()
  OR "doctorId" = public.telemedicine_current_user_id()
  OR public.telemedicine_is_admin()
);

CREATE POLICY "Doctors manage own slots"
ON public."Slot"
FOR ALL
TO authenticated
USING ("doctorId" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin())
WITH CHECK ("doctorId" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin());

CREATE POLICY "Patients manage family members"
ON public."FamilyMember"
FOR ALL
TO authenticated
USING ("ownerPatientId" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin())
WITH CHECK ("ownerPatientId" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin());

CREATE POLICY "Owners and appointment doctors can read documents"
ON public."Document"
FOR SELECT
TO authenticated
USING (
  "ownerId" = public.telemedicine_current_user_id()
  OR public.telemedicine_is_admin()
  OR EXISTS (
    SELECT 1
    FROM public."Appointment" appointment
    WHERE appointment."id" = "Document"."appointmentId"
      AND appointment."doctorId" = public.telemedicine_current_user_id()
  )
);

CREATE POLICY "Owners can insert documents"
ON public."Document"
FOR INSERT
TO authenticated
WITH CHECK ("ownerId" = public.telemedicine_current_user_id() OR public.telemedicine_is_admin());

CREATE POLICY "Lab catalog readable by authenticated users"
ON public."LabTestCatalog"
FOR SELECT
TO authenticated
USING (TRUE);

CREATE POLICY "Admins manage lab catalog"
ON public."LabTestCatalog"
FOR ALL
TO authenticated
USING (public.telemedicine_is_admin())
WITH CHECK (public.telemedicine_is_admin());



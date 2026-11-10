-- Imported existing Quick-Clinic schema without data.
-- Source clinical rows belong only in the private migration backup, never Git.
-- Custom FastAPI sessions authorize access; the Supabase Data API has no anonymous or authenticated grants.
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (9045acd)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: AppointmentStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AppointmentStatus" AS ENUM (
    'PENDING',
    'CONFIRMED',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW',
    'RESCHEDULED',
    'EXPIRED'
);


--
-- Name: CheckoutStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CheckoutStatus" AS ENUM (
    'PENDING_ORDER',
    'READY_FOR_PAYMENT',
    'CONFIRMED',
    'EXPIRED',
    'FAILED',
    'UNRESOLVED',
    'MANUAL_REVIEW'
);


--
-- Name: Gender; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Gender" AS ENUM (
    'MALE',
    'FEMALE',
    'BINARY'
);


--
-- Name: MedicalAiMessageRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MedicalAiMessageRole" AS ENUM (
    'USER',
    'ASSISTANT'
);


--
-- Name: MedicalAiMessageStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MedicalAiMessageStatus" AS ENUM (
    'COMPLETE',
    'FAILED'
);


--
-- Name: MedicalDocumentProcessingStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MedicalDocumentProcessingStatus" AS ENUM (
    'PENDING',
    'QUEUED',
    'PROCESSING',
    'READY',
    'FAILED'
);


--
-- Name: MedicalDocumentType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MedicalDocumentType" AS ENUM (
    'LAB_REPORT',
    'PRESCRIPTION',
    'RADIOLOGY_SCAN',
    'DISCHARGE_SUMMARY',
    'MEDICAL_CERTIFICATE',
    'VACCINATION_RECORD',
    'OTHER'
);


--
-- Name: OutboxStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."OutboxStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'DELIVERED',
    'FAILED'
);


--
-- Name: PaymentMethod; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PaymentMethod" AS ENUM (
    'OFFLINE',
    'ONLINE'
);


--
-- Name: Qualification; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Qualification" AS ENUM (
    'MBBS',
    'BDS',
    'BPT',
    'BHMS',
    'BAMS',
    'MD',
    'MS',
    'DNB',
    'MDS',
    'DM',
    'MCH',
    'MPH',
    'MBA_HM',
    'PHD',
    'DO',
    'FELLOWSHIP',
    'PGD'
);


--
-- Name: RefundStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RefundStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'PROCESSED',
    'FAILED'
);


--
-- Name: Role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Role" AS ENUM (
    'PATIENT',
    'DOCTOR',
    'ADMIN'
);


--
-- Name: SlotStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SlotStatus" AS ENUM (
    'AVAILABLE',
    'HELD',
    'BOOKED',
    'UNAVAILABLE',
    'CANCELLED',
    'ON_LEAVE'
);


--
-- Name: Specialty; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Specialty" AS ENUM (
    'CARDIOLOGIST',
    'DERMATOLOGIST',
    'PEDIATRICIAN',
    'NEUROLOGIST',
    'NEPHROLOGIST',
    'GASTROENTEROLOGIST',
    'ENDOCRINOLOGIST',
    'PULMONOLOGIST',
    'ONCOLOGIST',
    'ORTHOPEDIC',
    'OPHTHALMOLOGIST',
    'OTOLARYNGOLOGIST',
    'UROLOGIST',
    'RHEUMATOLOGIST',
    'PSYCHIATRIST',
    'PSYCHOLOGIST',
    'GENERAL_PHYSICIAN',
    'GENERAL_SURGEON',
    'RADIOLOGIST',
    'PATHOLOGIST',
    'HEMATOLOGIST',
    'DENTIST',
    'GYNECOLOGIST',
    'OBSTETRICIAN',
    'PLASTIC_SURGEON',
    'VASCULAR_SURGEON',
    'CARDIOTHORACIC_SURGEON',
    'DERMATOSURGEON',
    'INFECTIOUS_DISEASE_SPECIALIST',
    'IMMUNOLOGIST',
    'ANESTHESIOLOGIST',
    'EMERGENCY_MEDICINE',
    'SPORTS_MEDICINE',
    'PAIN_MEDICINE',
    'CRITICAL_CARE',
    'PHYSIOTHERAPIST',
    'NUTRITIONIST'
);


--
-- Name: WebhookEventStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."WebhookEventStatus" AS ENUM (
    'RECEIVED',
    'PROCESSING',
    'PROCESSED',
    'FAILED',
    'IGNORED'
);


--
-- Name: WithdrawalStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."WithdrawalStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'CANCELLED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AccessLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AccessLog" (
    id text NOT NULL,
    "userId" text,
    "targetId" text,
    action text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tag text DEFAULT 'SYSTEM'::text
);


--
-- Name: Admin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Admin" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "managerId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Appointment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Appointment" (
    id text NOT NULL,
    "doctorId" text NOT NULL,
    "patientId" text NOT NULL,
    "slotId" text NOT NULL,
    status public."AppointmentStatus" DEFAULT 'PENDING'::public."AppointmentStatus" NOT NULL,
    "paymentMethod" public."PaymentMethod" DEFAULT 'OFFLINE'::public."PaymentMethod" NOT NULL,
    "transactionId" text,
    notes text,
    "bookedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "isAppointmentOffline" boolean DEFAULT true NOT NULL,
    "paymentId" text
);


--
-- Name: AuditLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuditLog" (
    id text NOT NULL,
    "userId" text,
    action text NOT NULL,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tag text DEFAULT 'SYSTEM'::text
);


--
-- Name: BankAccount; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BankAccount" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "bankAccountNumber" text NOT NULL,
    "bankIFSC" text NOT NULL,
    "bankAccountHolderName" text NOT NULL,
    "bankName" text NOT NULL
);


--
-- Name: ChatMessages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ChatMessages" (
    id text NOT NULL,
    "doctorPatientRelationId" text NOT NULL,
    text text NOT NULL,
    "senderId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "clientMessageId" text,
    "isRead" boolean DEFAULT false NOT NULL,
    "readAt" timestamp(3) without time zone
);


--
-- Name: Checkout; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Checkout" (
    id text NOT NULL,
    "idempotencyKey" text NOT NULL,
    "userId" text NOT NULL,
    "patientId" text NOT NULL,
    "doctorId" text NOT NULL,
    "slotId" text NOT NULL,
    "holdToken" text NOT NULL,
    "paymentMethod" public."PaymentMethod" DEFAULT 'ONLINE'::public."PaymentMethod" NOT NULL,
    amount integer NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    status public."CheckoutStatus" DEFAULT 'PENDING_ORDER'::public."CheckoutStatus" NOT NULL,
    "razorpayOrderId" text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "paymentId" text,
    "appointmentId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "confirmedAt" timestamp(3) without time zone,
    attempts integer DEFAULT 0 NOT NULL,
    "lastAttemptAt" timestamp(3) without time zone,
    "lastError" text,
    "leaseExpiresAt" timestamp(3) without time zone,
    "leaseOwner" text,
    "nextAttemptAt" timestamp(3) without time zone,
    "processingStartedAt" timestamp(3) without time zone,
    "providerReference" text
);


--
-- Name: Comment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Comment" (
    id text NOT NULL,
    "doctorId" text NOT NULL,
    text text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "patientId" text NOT NULL
);


--
-- Name: Doctor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Doctor" (
    id text NOT NULL,
    "userId" text NOT NULL,
    specialty public."Specialty" NOT NULL,
    experience integer DEFAULT 0 NOT NULL,
    fees integer DEFAULT 0 NOT NULL,
    "doctorBio" text,
    balance integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    latitude double precision,
    longitude double precision,
    "isReleaseFixture" boolean DEFAULT false NOT NULL
);


--
-- Name: DoctorPatientRelation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DoctorPatientRelation" (
    id text NOT NULL,
    "doctorsUserId" text NOT NULL,
    "patientsUserId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "doctorLastReadAt" timestamp(3) without time zone,
    "patientLastReadAt" timestamp(3) without time zone
);


--
-- Name: DoctorQualification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DoctorQualification" (
    id text NOT NULL,
    "doctorId" text NOT NULL,
    qualification public."Qualification" NOT NULL
);


--
-- Name: Leave; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Leave" (
    id text NOT NULL,
    "doctorId" text NOT NULL,
    reason text NOT NULL,
    "startDate" timestamp(3) without time zone NOT NULL,
    "endDate" timestamp(3) without time zone NOT NULL,
    "applyAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Location; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Location" (
    pincode integer NOT NULL,
    city text NOT NULL,
    state text NOT NULL
);


--
-- Name: MedicalAiConversation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MedicalAiConversation" (
    id text NOT NULL,
    "doctorId" text NOT NULL,
    "patientId" text NOT NULL,
    title text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: MedicalAiMessage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MedicalAiMessage" (
    id text NOT NULL,
    "conversationId" text NOT NULL,
    role public."MedicalAiMessageRole" NOT NULL,
    content text NOT NULL,
    citations jsonb,
    status public."MedicalAiMessageStatus" DEFAULT 'COMPLETE'::public."MedicalAiMessageStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: MedicalDocument; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MedicalDocument" (
    id text NOT NULL,
    "patientId" text NOT NULL,
    title text NOT NULL,
    type public."MedicalDocumentType" NOT NULL,
    "fileName" text NOT NULL,
    "mimeType" text NOT NULL,
    "fileSize" integer NOT NULL,
    "storagePath" text NOT NULL,
    "reportDate" timestamp(3) without time zone NOT NULL,
    "hospitalOrDoctor" text,
    notes text,
    "processingStatus" public."MedicalDocumentProcessingStatus" DEFAULT 'PENDING'::public."MedicalDocumentProcessingStatus" NOT NULL,
    "processingError" text,
    "processedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Notification" (
    id text NOT NULL,
    "userId" text NOT NULL,
    message text NOT NULL,
    "isRead" boolean DEFAULT false NOT NULL,
    status text DEFAULT 'UNREAD'::text NOT NULL,
    "readAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "actionHref" text,
    "actionLabel" text,
    "eventId" text
);


--
-- Name: NotificationOutbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NotificationOutbox" (
    id text NOT NULL,
    "eventId" text NOT NULL,
    channel text NOT NULL,
    "targetUserId" text NOT NULL,
    payload jsonb NOT NULL,
    status public."OutboxStatus" DEFAULT 'PENDING'::public."OutboxStatus" NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "lastError" text,
    "lastAttemptAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deliveredAt" timestamp(3) without time zone,
    "leaseExpiresAt" timestamp(3) without time zone,
    "leaseOwner" text,
    "nextAttemptAt" timestamp(3) without time zone,
    "processingStartedAt" timestamp(3) without time zone
);


--
-- Name: Otp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Otp" (
    id text NOT NULL,
    email text NOT NULL,
    "userId" text NOT NULL,
    code text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: Patient; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Patient" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "medicalHistory" text DEFAULT ''::text NOT NULL,
    allergies text DEFAULT ''::text NOT NULL,
    "currentMedications" text DEFAULT ''::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Payment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Payment" (
    id text NOT NULL,
    amount integer NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    "userId" text NOT NULL,
    status text NOT NULL,
    "razorpayOrderId" text NOT NULL,
    "razorpayPaymentId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "doctorId" text,
    "holdToken" text,
    "slotId" text,
    "idempotencyKey" text,
    "capturedAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "leaseExpiresAt" timestamp(3) without time zone,
    "leaseOwner" text,
    "nextAttemptAt" timestamp(3) without time zone
);


--
-- Name: Rating; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Rating" (
    id text NOT NULL,
    "doctorId" text NOT NULL,
    rating integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "patientId" text NOT NULL
);


--
-- Name: Refund; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Refund" (
    id text NOT NULL,
    "paymentId" text NOT NULL,
    amount integer NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    reason text NOT NULL,
    status public."RefundStatus" DEFAULT 'PENDING'::public."RefundStatus" NOT NULL,
    "idempotencyKey" text NOT NULL,
    "razorpayRefundId" text,
    "failureReason" text,
    attempts integer DEFAULT 0 NOT NULL,
    "lastAttemptAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "processedAt" timestamp(3) without time zone,
    "leaseExpiresAt" timestamp(3) without time zone,
    "leaseOwner" text,
    "nextAttemptAt" timestamp(3) without time zone
);


--
-- Name: Schedule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Schedule" (
    id text NOT NULL,
    "doctorId" text NOT NULL,
    "weeklySchedule" jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Slot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Slot" (
    id text NOT NULL,
    "doctorId" text NOT NULL,
    date date NOT NULL,
    "startTime" timestamp(3) without time zone NOT NULL,
    "endTime" timestamp(3) without time zone NOT NULL,
    status public."SlotStatus" DEFAULT 'AVAILABLE'::public."SlotStatus" NOT NULL,
    "heldByPatientId" text,
    "heldAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "holdExpiresAt" timestamp(3) without time zone,
    "holdToken" text
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    "phoneNo" text NOT NULL,
    name text NOT NULL,
    password text NOT NULL,
    age integer NOT NULL,
    gender public."Gender" DEFAULT 'MALE'::public."Gender" NOT NULL,
    role public."Role" DEFAULT 'PATIENT'::public."Role" NOT NULL,
    address text NOT NULL,
    "pinCode" integer NOT NULL,
    "profileImageUrl" text,
    "emailVerified" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: WebhookEvent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WebhookEvent" (
    id text NOT NULL,
    "providerEventId" text NOT NULL,
    "eventType" text NOT NULL,
    "paymentId" text,
    status public."WebhookEventStatus" DEFAULT 'RECEIVED'::public."WebhookEventStatus" NOT NULL,
    payload jsonb NOT NULL,
    "processingError" text,
    "receivedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "processedAt" timestamp(3) without time zone,
    attempts integer DEFAULT 0 NOT NULL,
    "leaseExpiresAt" timestamp(3) without time zone,
    "leaseOwner" text,
    "nextAttemptAt" timestamp(3) without time zone,
    "processingStartedAt" timestamp(3) without time zone
);


--
-- Name: Withdrawal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Withdrawal" (
    id text NOT NULL,
    "doctorId" text NOT NULL,
    amount integer NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    status public."WithdrawalStatus" DEFAULT 'PENDING'::public."WithdrawalStatus" NOT NULL,
    "razorpayPayoutId" text,
    "failureReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "processedAt" timestamp(3) without time zone
);


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: AccessLog AccessLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AccessLog"
    ADD CONSTRAINT "AccessLog_pkey" PRIMARY KEY (id);


--
-- Name: Admin Admin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Admin"
    ADD CONSTRAINT "Admin_pkey" PRIMARY KEY (id);


--
-- Name: Appointment Appointment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Appointment"
    ADD CONSTRAINT "Appointment_pkey" PRIMARY KEY (id);


--
-- Name: AuditLog AuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);


--
-- Name: BankAccount BankAccount_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BankAccount"
    ADD CONSTRAINT "BankAccount_pkey" PRIMARY KEY (id);


--
-- Name: ChatMessages ChatMessages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChatMessages"
    ADD CONSTRAINT "ChatMessages_pkey" PRIMARY KEY (id);


--
-- Name: Checkout Checkout_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkout"
    ADD CONSTRAINT "Checkout_pkey" PRIMARY KEY (id);


--
-- Name: Comment Comment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Comment"
    ADD CONSTRAINT "Comment_pkey" PRIMARY KEY (id);


--
-- Name: DoctorPatientRelation DoctorPatientRelation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DoctorPatientRelation"
    ADD CONSTRAINT "DoctorPatientRelation_pkey" PRIMARY KEY (id);


--
-- Name: DoctorQualification DoctorQualification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DoctorQualification"
    ADD CONSTRAINT "DoctorQualification_pkey" PRIMARY KEY (id);


--
-- Name: Doctor Doctor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Doctor"
    ADD CONSTRAINT "Doctor_pkey" PRIMARY KEY (id);


--
-- Name: Leave Leave_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Leave"
    ADD CONSTRAINT "Leave_pkey" PRIMARY KEY (id);


--
-- Name: Location Location_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Location"
    ADD CONSTRAINT "Location_pkey" PRIMARY KEY (pincode);


--
-- Name: MedicalAiConversation MedicalAiConversation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MedicalAiConversation"
    ADD CONSTRAINT "MedicalAiConversation_pkey" PRIMARY KEY (id);


--
-- Name: MedicalAiMessage MedicalAiMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MedicalAiMessage"
    ADD CONSTRAINT "MedicalAiMessage_pkey" PRIMARY KEY (id);


--
-- Name: MedicalDocument MedicalDocument_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MedicalDocument"
    ADD CONSTRAINT "MedicalDocument_pkey" PRIMARY KEY (id);


--
-- Name: NotificationOutbox NotificationOutbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NotificationOutbox"
    ADD CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY (id);


--
-- Name: Notification Notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notification"
    ADD CONSTRAINT "Notification_pkey" PRIMARY KEY (id);


--
-- Name: Otp Otp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Otp"
    ADD CONSTRAINT "Otp_pkey" PRIMARY KEY (id);


--
-- Name: Patient Patient_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Patient"
    ADD CONSTRAINT "Patient_pkey" PRIMARY KEY (id);


--
-- Name: Payment Payment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_pkey" PRIMARY KEY (id);


--
-- Name: Rating Rating_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Rating"
    ADD CONSTRAINT "Rating_pkey" PRIMARY KEY (id);


--
-- Name: Refund Refund_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Refund"
    ADD CONSTRAINT "Refund_pkey" PRIMARY KEY (id);


--
-- Name: Schedule Schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Schedule"
    ADD CONSTRAINT "Schedule_pkey" PRIMARY KEY (id);


--
-- Name: Slot Slot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Slot"
    ADD CONSTRAINT "Slot_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: WebhookEvent WebhookEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WebhookEvent"
    ADD CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY (id);


--
-- Name: Withdrawal Withdrawal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Withdrawal"
    ADD CONSTRAINT "Withdrawal_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: AccessLog_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AccessLog_createdAt_idx" ON public."AccessLog" USING btree ("createdAt");


--
-- Name: AccessLog_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AccessLog_tag_idx" ON public."AccessLog" USING btree (tag);


--
-- Name: AccessLog_targetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AccessLog_targetId_idx" ON public."AccessLog" USING btree ("targetId");


--
-- Name: AccessLog_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AccessLog_userId_createdAt_idx" ON public."AccessLog" USING btree ("userId", "createdAt");


--
-- Name: AccessLog_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AccessLog_userId_idx" ON public."AccessLog" USING btree ("userId");


--
-- Name: Admin_managerId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Admin_managerId_idx" ON public."Admin" USING btree ("managerId");


--
-- Name: Admin_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Admin_userId_idx" ON public."Admin" USING btree ("userId");


--
-- Name: Admin_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Admin_userId_key" ON public."Admin" USING btree ("userId");


--
-- Name: Appointment_active_slot_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Appointment_active_slot_unique" ON public."Appointment" USING btree ("slotId") WHERE (status = ANY (ARRAY['PENDING'::public."AppointmentStatus", 'CONFIRMED'::public."AppointmentStatus", 'COMPLETED'::public."AppointmentStatus", 'NO_SHOW'::public."AppointmentStatus"]));


--
-- Name: Appointment_doctorId_patientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Appointment_doctorId_patientId_idx" ON public."Appointment" USING btree ("doctorId", "patientId");


--
-- Name: Appointment_paymentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Appointment_paymentId_key" ON public."Appointment" USING btree ("paymentId");


--
-- Name: Appointment_slotId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Appointment_slotId_idx" ON public."Appointment" USING btree ("slotId");


--
-- Name: Appointment_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Appointment_status_idx" ON public."Appointment" USING btree (status);


--
-- Name: AuditLog_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_createdAt_idx" ON public."AuditLog" USING btree ("createdAt");


--
-- Name: AuditLog_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_tag_idx" ON public."AuditLog" USING btree (tag);


--
-- Name: AuditLog_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_userId_createdAt_idx" ON public."AuditLog" USING btree ("userId", "createdAt");


--
-- Name: AuditLog_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_userId_idx" ON public."AuditLog" USING btree ("userId");


--
-- Name: BankAccount_bankAccountNumber_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "BankAccount_bankAccountNumber_key" ON public."BankAccount" USING btree ("bankAccountNumber");


--
-- Name: ChatMessages_clientMessageId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ChatMessages_clientMessageId_key" ON public."ChatMessages" USING btree ("clientMessageId");


--
-- Name: ChatMessages_doctorPatientRelationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ChatMessages_doctorPatientRelationId_createdAt_idx" ON public."ChatMessages" USING btree ("doctorPatientRelationId", "createdAt");


--
-- Name: ChatMessages_doctorPatientRelationId_isRead_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ChatMessages_doctorPatientRelationId_isRead_idx" ON public."ChatMessages" USING btree ("doctorPatientRelationId", "isRead");


--
-- Name: ChatMessages_senderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ChatMessages_senderId_idx" ON public."ChatMessages" USING btree ("senderId");


--
-- Name: Checkout_appointmentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Checkout_appointmentId_key" ON public."Checkout" USING btree ("appointmentId");


--
-- Name: Checkout_doctorId_slotId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Checkout_doctorId_slotId_idx" ON public."Checkout" USING btree ("doctorId", "slotId");


--
-- Name: Checkout_expiresAt_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Checkout_expiresAt_status_idx" ON public."Checkout" USING btree ("expiresAt", status);


--
-- Name: Checkout_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Checkout_idempotencyKey_key" ON public."Checkout" USING btree ("idempotencyKey");


--
-- Name: Checkout_paymentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Checkout_paymentId_key" ON public."Checkout" USING btree ("paymentId");


--
-- Name: Checkout_providerReference_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Checkout_providerReference_idx" ON public."Checkout" USING btree ("providerReference");


--
-- Name: Checkout_razorpayOrderId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Checkout_razorpayOrderId_idx" ON public."Checkout" USING btree ("razorpayOrderId");


--
-- Name: Checkout_razorpayOrderId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Checkout_razorpayOrderId_key" ON public."Checkout" USING btree ("razorpayOrderId");


--
-- Name: Checkout_status_nextAttemptAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Checkout_status_nextAttemptAt_idx" ON public."Checkout" USING btree (status, "nextAttemptAt");


--
-- Name: Checkout_userId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Checkout_userId_status_idx" ON public."Checkout" USING btree ("userId", status);


--
-- Name: Comment_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comment_createdAt_idx" ON public."Comment" USING btree ("createdAt");


--
-- Name: Comment_doctorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comment_doctorId_idx" ON public."Comment" USING btree ("doctorId");


--
-- Name: Comment_patientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Comment_patientId_idx" ON public."Comment" USING btree ("patientId");


--
-- Name: DoctorPatientRelation_doctorsUserId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DoctorPatientRelation_doctorsUserId_idx" ON public."DoctorPatientRelation" USING btree ("doctorsUserId");


--
-- Name: DoctorPatientRelation_doctorsUserId_patientsUserId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "DoctorPatientRelation_doctorsUserId_patientsUserId_key" ON public."DoctorPatientRelation" USING btree ("doctorsUserId", "patientsUserId");


--
-- Name: DoctorPatientRelation_patientsUserId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DoctorPatientRelation_patientsUserId_idx" ON public."DoctorPatientRelation" USING btree ("patientsUserId");


--
-- Name: DoctorQualification_doctorId_qualification_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "DoctorQualification_doctorId_qualification_key" ON public."DoctorQualification" USING btree ("doctorId", qualification);


--
-- Name: Doctor_latitude_longitude_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Doctor_latitude_longitude_idx" ON public."Doctor" USING btree (latitude, longitude);


--
-- Name: Doctor_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Doctor_userId_key" ON public."Doctor" USING btree ("userId");


--
-- Name: Leave_doctorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Leave_doctorId_idx" ON public."Leave" USING btree ("doctorId");


--
-- Name: Leave_doctorId_startDate_endDate_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Leave_doctorId_startDate_endDate_key" ON public."Leave" USING btree ("doctorId", "startDate", "endDate");


--
-- Name: Leave_startDate_endDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Leave_startDate_endDate_idx" ON public."Leave" USING btree ("startDate", "endDate");


--
-- Name: Location_pincode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Location_pincode_key" ON public."Location" USING btree (pincode);


--
-- Name: MedicalAiConversation_doctorId_patientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MedicalAiConversation_doctorId_patientId_idx" ON public."MedicalAiConversation" USING btree ("doctorId", "patientId");


--
-- Name: MedicalAiConversation_doctorId_updatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MedicalAiConversation_doctorId_updatedAt_idx" ON public."MedicalAiConversation" USING btree ("doctorId", "updatedAt");


--
-- Name: MedicalAiMessage_conversationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MedicalAiMessage_conversationId_createdAt_idx" ON public."MedicalAiMessage" USING btree ("conversationId", "createdAt");


--
-- Name: MedicalDocument_patientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MedicalDocument_patientId_idx" ON public."MedicalDocument" USING btree ("patientId");


--
-- Name: MedicalDocument_patientId_processingStatus_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MedicalDocument_patientId_processingStatus_idx" ON public."MedicalDocument" USING btree ("patientId", "processingStatus");


--
-- Name: MedicalDocument_patientId_reportDate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MedicalDocument_patientId_reportDate_idx" ON public."MedicalDocument" USING btree ("patientId", "reportDate");


--
-- Name: MedicalDocument_patientId_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MedicalDocument_patientId_type_idx" ON public."MedicalDocument" USING btree ("patientId", type);


--
-- Name: MedicalDocument_storagePath_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "MedicalDocument_storagePath_key" ON public."MedicalDocument" USING btree ("storagePath");


--
-- Name: NotificationOutbox_eventId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "NotificationOutbox_eventId_key" ON public."NotificationOutbox" USING btree ("eventId");


--
-- Name: NotificationOutbox_status_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NotificationOutbox_status_createdAt_idx" ON public."NotificationOutbox" USING btree (status, "createdAt");


--
-- Name: NotificationOutbox_status_nextAttemptAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON public."NotificationOutbox" USING btree (status, "nextAttemptAt");


--
-- Name: NotificationOutbox_targetUserId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NotificationOutbox_targetUserId_idx" ON public."NotificationOutbox" USING btree ("targetUserId");


--
-- Name: Notification_userId_eventId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Notification_userId_eventId_key" ON public."Notification" USING btree ("userId", "eventId");


--
-- Name: Notification_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Notification_userId_idx" ON public."Notification" USING btree ("userId");


--
-- Name: Otp_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Otp_email_key" ON public."Otp" USING btree (email);


--
-- Name: Otp_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Otp_userId_key" ON public."Otp" USING btree ("userId");


--
-- Name: Patient_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Patient_userId_key" ON public."Patient" USING btree ("userId");


--
-- Name: Payment_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON public."Payment" USING btree ("idempotencyKey");


--
-- Name: Payment_razorpayOrderId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Payment_razorpayOrderId_key" ON public."Payment" USING btree ("razorpayOrderId");


--
-- Name: Payment_razorpayPaymentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Payment_razorpayPaymentId_idx" ON public."Payment" USING btree ("razorpayPaymentId");


--
-- Name: Payment_razorpayPaymentId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Payment_razorpayPaymentId_key" ON public."Payment" USING btree ("razorpayPaymentId");


--
-- Name: Payment_slotId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Payment_slotId_idx" ON public."Payment" USING btree ("slotId");


--
-- Name: Payment_status_nextAttemptAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Payment_status_nextAttemptAt_idx" ON public."Payment" USING btree (status, "nextAttemptAt");


--
-- Name: Payment_userId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Payment_userId_status_idx" ON public."Payment" USING btree ("userId", status);


--
-- Name: Rating_doctorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Rating_doctorId_idx" ON public."Rating" USING btree ("doctorId");


--
-- Name: Rating_doctorId_patientId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Rating_doctorId_patientId_key" ON public."Rating" USING btree ("doctorId", "patientId");


--
-- Name: Rating_patientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Rating_patientId_idx" ON public."Rating" USING btree ("patientId");


--
-- Name: Refund_idempotencyKey_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON public."Refund" USING btree ("idempotencyKey");


--
-- Name: Refund_paymentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Refund_paymentId_idx" ON public."Refund" USING btree ("paymentId");


--
-- Name: Refund_razorpayRefundId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Refund_razorpayRefundId_key" ON public."Refund" USING btree ("razorpayRefundId");


--
-- Name: Refund_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Refund_status_idx" ON public."Refund" USING btree (status);


--
-- Name: Refund_status_nextAttemptAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Refund_status_nextAttemptAt_idx" ON public."Refund" USING btree (status, "nextAttemptAt");


--
-- Name: Schedule_doctorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Schedule_doctorId_idx" ON public."Schedule" USING btree ("doctorId");


--
-- Name: Schedule_doctorId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Schedule_doctorId_key" ON public."Schedule" USING btree ("doctorId");


--
-- Name: Slot_doctorId_date_startTime_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Slot_doctorId_date_startTime_key" ON public."Slot" USING btree ("doctorId", date, "startTime");


--
-- Name: Slot_doctorId_date_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Slot_doctorId_date_status_idx" ON public."Slot" USING btree ("doctorId", date, status);


--
-- Name: Slot_heldByPatientId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Slot_heldByPatientId_idx" ON public."Slot" USING btree ("heldByPatientId");


--
-- Name: Slot_holdExpiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Slot_holdExpiresAt_idx" ON public."Slot" USING btree ("holdExpiresAt");


--
-- Name: Slot_startTime_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Slot_startTime_status_idx" ON public."Slot" USING btree ("startTime", status);


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: WebhookEvent_eventType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WebhookEvent_eventType_idx" ON public."WebhookEvent" USING btree ("eventType");


--
-- Name: WebhookEvent_paymentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WebhookEvent_paymentId_idx" ON public."WebhookEvent" USING btree ("paymentId");


--
-- Name: WebhookEvent_providerEventId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "WebhookEvent_providerEventId_key" ON public."WebhookEvent" USING btree ("providerEventId");


--
-- Name: WebhookEvent_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WebhookEvent_status_idx" ON public."WebhookEvent" USING btree (status);


--
-- Name: WebhookEvent_status_nextAttemptAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WebhookEvent_status_nextAttemptAt_idx" ON public."WebhookEvent" USING btree (status, "nextAttemptAt");


--
-- Name: Withdrawal_doctorId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Withdrawal_doctorId_idx" ON public."Withdrawal" USING btree ("doctorId");


--
-- Name: Withdrawal_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Withdrawal_status_idx" ON public."Withdrawal" USING btree (status);


--
-- Name: AccessLog AccessLog_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AccessLog"
    ADD CONSTRAINT "AccessLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Admin Admin_managerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Admin"
    ADD CONSTRAINT "Admin_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES public."Admin"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Admin Admin_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Admin"
    ADD CONSTRAINT "Admin_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Appointment Appointment_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Appointment"
    ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Appointment Appointment_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Appointment"
    ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES public."Patient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Appointment Appointment_paymentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Appointment"
    ADD CONSTRAINT "Appointment_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES public."Payment"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Appointment Appointment_slotId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Appointment"
    ADD CONSTRAINT "Appointment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES public."Slot"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: AuditLog AuditLog_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: BankAccount BankAccount_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BankAccount"
    ADD CONSTRAINT "BankAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChatMessages ChatMessages_doctorPatientRelationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChatMessages"
    ADD CONSTRAINT "ChatMessages_doctorPatientRelationId_fkey" FOREIGN KEY ("doctorPatientRelationId") REFERENCES public."DoctorPatientRelation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChatMessages ChatMessages_senderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ChatMessages"
    ADD CONSTRAINT "ChatMessages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Checkout Checkout_appointmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkout"
    ADD CONSTRAINT "Checkout_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES public."Appointment"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Checkout Checkout_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkout"
    ADD CONSTRAINT "Checkout_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Checkout Checkout_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkout"
    ADD CONSTRAINT "Checkout_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES public."Patient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Checkout Checkout_paymentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkout"
    ADD CONSTRAINT "Checkout_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES public."Payment"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Checkout Checkout_slotId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkout"
    ADD CONSTRAINT "Checkout_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES public."Slot"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Checkout Checkout_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Checkout"
    ADD CONSTRAINT "Checkout_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Comment Comment_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Comment"
    ADD CONSTRAINT "Comment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Comment Comment_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Comment"
    ADD CONSTRAINT "Comment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES public."Patient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: DoctorPatientRelation DoctorPatientRelation_doctorsUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DoctorPatientRelation"
    ADD CONSTRAINT "DoctorPatientRelation_doctorsUserId_fkey" FOREIGN KEY ("doctorsUserId") REFERENCES public."Doctor"("userId") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: DoctorPatientRelation DoctorPatientRelation_patientsUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DoctorPatientRelation"
    ADD CONSTRAINT "DoctorPatientRelation_patientsUserId_fkey" FOREIGN KEY ("patientsUserId") REFERENCES public."Patient"("userId") ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: DoctorQualification DoctorQualification_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DoctorQualification"
    ADD CONSTRAINT "DoctorQualification_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Doctor Doctor_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Doctor"
    ADD CONSTRAINT "Doctor_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Leave Leave_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Leave"
    ADD CONSTRAINT "Leave_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MedicalAiConversation MedicalAiConversation_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MedicalAiConversation"
    ADD CONSTRAINT "MedicalAiConversation_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MedicalAiConversation MedicalAiConversation_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MedicalAiConversation"
    ADD CONSTRAINT "MedicalAiConversation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES public."Patient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MedicalAiMessage MedicalAiMessage_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MedicalAiMessage"
    ADD CONSTRAINT "MedicalAiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public."MedicalAiConversation"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MedicalDocument MedicalDocument_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MedicalDocument"
    ADD CONSTRAINT "MedicalDocument_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES public."Patient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Notification Notification_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notification"
    ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Otp Otp_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Otp"
    ADD CONSTRAINT "Otp_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Patient Patient_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Patient"
    ADD CONSTRAINT "Patient_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Payment Payment_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Rating Rating_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Rating"
    ADD CONSTRAINT "Rating_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Rating Rating_patientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Rating"
    ADD CONSTRAINT "Rating_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES public."Patient"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Refund Refund_paymentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Refund"
    ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES public."Payment"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Schedule Schedule_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Schedule"
    ADD CONSTRAINT "Schedule_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Slot Slot_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Slot"
    ADD CONSTRAINT "Slot_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: User User_pinCode_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pinCode_fkey" FOREIGN KEY ("pinCode") REFERENCES public."Location"(pincode) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: WebhookEvent WebhookEvent_paymentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WebhookEvent"
    ADD CONSTRAINT "WebhookEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES public."Payment"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Withdrawal Withdrawal_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Withdrawal"
    ADD CONSTRAINT "Withdrawal_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



-- Server-only database access and separate storage privacy.
ALTER TABLE public."AccessLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."AccessLog" FROM anon, authenticated;
ALTER TABLE public."Admin" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Admin" FROM anon, authenticated;
ALTER TABLE public."Appointment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Appointment" FROM anon, authenticated;
ALTER TABLE public."AuditLog" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."AuditLog" FROM anon, authenticated;
ALTER TABLE public."BankAccount" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."BankAccount" FROM anon, authenticated;
ALTER TABLE public."ChatMessages" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."ChatMessages" FROM anon, authenticated;
ALTER TABLE public."Checkout" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Checkout" FROM anon, authenticated;
ALTER TABLE public."Comment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Comment" FROM anon, authenticated;
ALTER TABLE public."Doctor" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Doctor" FROM anon, authenticated;
ALTER TABLE public."DoctorPatientRelation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."DoctorPatientRelation" FROM anon, authenticated;
ALTER TABLE public."DoctorQualification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."DoctorQualification" FROM anon, authenticated;
ALTER TABLE public."Leave" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Leave" FROM anon, authenticated;
ALTER TABLE public."Location" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Location" FROM anon, authenticated;
ALTER TABLE public."MedicalAiConversation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."MedicalAiConversation" FROM anon, authenticated;
ALTER TABLE public."MedicalAiMessage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."MedicalAiMessage" FROM anon, authenticated;
ALTER TABLE public."MedicalDocument" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."MedicalDocument" FROM anon, authenticated;
ALTER TABLE public."Notification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Notification" FROM anon, authenticated;
ALTER TABLE public."NotificationOutbox" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."NotificationOutbox" FROM anon, authenticated;
ALTER TABLE public."Otp" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Otp" FROM anon, authenticated;
ALTER TABLE public."Patient" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Patient" FROM anon, authenticated;
ALTER TABLE public."Payment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Payment" FROM anon, authenticated;
ALTER TABLE public."Rating" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Rating" FROM anon, authenticated;
ALTER TABLE public."Refund" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Refund" FROM anon, authenticated;
ALTER TABLE public."Schedule" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Schedule" FROM anon, authenticated;
ALTER TABLE public."Slot" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Slot" FROM anon, authenticated;
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."User" FROM anon, authenticated;
ALTER TABLE public."WebhookEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."WebhookEvent" FROM anon, authenticated;
ALTER TABLE public."Withdrawal" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."Withdrawal" FROM anon, authenticated;
ALTER TABLE public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."_prisma_migrations" FROM anon, authenticated;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types) VALUES ('quick-clinic-medical-documents','quick-clinic-medical-documents',false,10485760,ARRAY['application/pdf','image/jpeg','image/png','image/webp']), ('quick-clinic-avatars','quick-clinic-avatars',true,5242880,ARRAY['image/webp']) ON CONFLICT (id) DO NOTHING;

# Quick-Clinic Role Features Documentation

This document contains a detailed breakdown of the functionality and features available for each of the primary roles within the Quick-Clinic application.

## 1. Patient Features
- **User Authentication**: Secure sign up, login, and password management with email and OTP verification.
- **Profile Management**: Manage personal demographics, medical history, allergies, and current medications.
- **Doctor Search & Discovery**: Find doctors by specialty, location (pincode/city/state), and view doctor profiles, qualifications, ratings, and experience.
- **Appointment Booking**: View real-time slot availability, hold specific slots temporarily, and complete online (Razorpay) or offline payments to confirm the booking.
- **Appointment Management**: View upcoming, completed, and cancelled appointments. Reschedule or cancel appointments based on clinic policy.
- **Doctor-Patient Chat**: Secure direct messaging with assigned doctors for pre-consultation inquiries or post-consultation follow-ups.
- **Ratings & Reviews**: Share clinic experience by rating doctors (1-5 stars) and leaving detailed comments on the doctor's profile.
- **Notifications**: Receive instant alerts for appointment confirmations, doctor leave updates, and incoming chat messages.
- **Bank Accounts**: Manage personal bank/payment accounts for seamless online transactions.

## 2. Doctor Features
- **Professional Profile**: Construct a robust profile detailing specialty, years of experience, a personalized bio, and multiple verified qualifications (e.g., MBBS, MD, FELLOWSHIP).
- **Schedule Management**: Define rigid or flexible weekly recurring schedules and establish consultation base fees.
- **Slot Management**: The system automatically generates daily interaction slots. Doctors can monitor these slots as they shift through states (Available, Held, Booked, On Leave).
- **Leave Management**: Apply for leaves with specific start and end dates. The system tracks these and natively handles slot conflicts or auto-cancellations for appointments that fall within the leave period.
- **Appointments Dashboard**: Manage daily appointments comprehensively. Change statuses dynamically (from Pending to Confirmed, Completed, No Show, or Cancelled).
- **Patient Tracking**: View dedicated patient medical histories, allergy data, and current medications before consultation.
- **Earnings & Withdrawals**: Seamlessly track accumulated consultation earnings via the in-app `balance` ledger. Request automated withdrawals directly to verified registered bank accounts.
- **Feedback Monitoring**: Track incoming patient ratings and comments to improve care quality.

## 3. Admin Features
- **Platform Monitoring**: High-level operational dashboard to oversee overall application statistics, total users, active doctors, and transaction volumes.
- **User Management**: Capability to view, verify, and block/unblock User, Patient, and Doctor accounts to enforce platform integrity.
- **Financial Oversight**: Full visibility into patient payments and dedicated oversight for processing Doctor Withdrawal Requests (from Pending to Processing or Completed).
- **Sub-Admin Delegation**: Ability to establish an administrative hierarchy involving managers and sub-admins for scaling clinic operations.
- **System Logs Management**: Access to comprehensive `AuditLog` (data changes, security) and `AccessLog` (logins, session tracking) to maintain tight compliance and track any unauthorized actions.
- **Location Management**: Oversee and add supported pin codes, cities, and states for clinic routing.
- **Broadcast & Support**: Trigger system-wide or user-specific notifications to easily relay vital updates to Doctors or Patients.

# Quick-Clinic Entity-Relationship (ER) Diagram

This document illustrates the structural database design of the Quick-Clinic platform, reverse engineered from the Prisma schema. It visualizes the core connections between users, authentications, roles, scheduling, and transactions.

```mermaid
erDiagram
    %% Core User Module
    User ||--o| Admin : "is a (1:1)"
    User ||--o| Doctor : "is a (1:1)"
    User ||--o| Patient : "is a (1:1)"
    
    User ||--o{ Location : "mapped by pincode"
    User ||--o{ Notification : "receives"
    User ||--o{ BankAccount : "owns"
    User ||--o{ Payment : "initiates"
    User ||--o{ Otp : "authenticates via"
    User ||--o{ AccessLog : "triggers"

    User {
        String id PK
        String email
        String phoneNo
        String name
        Role role
        String password
        Gender gender
        Int pinCode FK
    }

    Location {
        Int pincode PK
        String city
        String state
    }

    %% Sub-roles
    Admin {
        String id PK
        String userId FK
        String managerId FK
    }

    Patient {
        String id PK
        String userId FK
        String medicalHistory
        String allergies
        String currentMedications
    }

    Doctor {
        String id PK
        String userId FK
        Specialty specialty
        Int experience
        Int fees
        Int balance
        String doctorBio
    }

    %% Doctor Specific Relations
    Doctor ||--o{ DoctorQualification : "achieved"
    Doctor ||--o{ Leave : "takes"
    Doctor ||--|| Schedule : "defines"
    Doctor ||--o{ Slot : "generates"
    Doctor ||--o{ Withdrawal : "requests"
    
    %% Patient -> Doctor Interactive Relations
    Patient ||--o{ Rating : "rates"
    Doctor ||--o{ Rating : "is rated"
    
    Patient ||--o{ Comment : "reviews"
    Doctor ||--o{ Comment : "is reviewed"

    %% Appointments & Logistics
    Slot ||--|| Appointment : "hosts"
    Doctor ||--o{ Appointment : "conducts"
    Patient ||--o{ Appointment : "books"

    Slot {
        String id PK
        String doctorId FK
        DateTime date
        DateTime startTime
        DateTime endTime
        String status
        String heldByPatientId
    }

    Appointment {
        String id PK
        String doctorId FK
        String patientId FK
        String slotId FK
        String status
        String paymentMethod
        String transactionId
    }

    %% Chat Engine
    Doctor ||--o{ DoctorPatientRelation : "connected to"
    Patient ||--o{ DoctorPatientRelation : "connected to"
    DoctorPatientRelation ||--o{ ChatMessages : "contains"
    
    DoctorPatientRelation {
        String id PK
        String doctorsUserId FK
        String patientsUserId FK
    }
    
    ChatMessages {
        String id PK
        String text
        String senderId FK
        DateTime createdAt
    }
```

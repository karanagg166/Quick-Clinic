# Quick-Clinic Workflows

This document outlines the core operational workflows and logics for the Quick-Clinic application using Mermaid.js charts. 

## 1. User Registration & Role Assignment Flow

```mermaid
flowchart TD
    A[User Visits App] --> B[Sign Up]
    B --> C[Verify OTP via Email/SMS]
    C --> D{Select Primary Role}
    
    D -- Patient --> E[Create Patient Profile]
    D -- Doctor --> F[Create Doctor Profile]
    
    E --> G[Submit Address, Medical Details & Allergies]
    F --> H[Submit Qualifications, Specialty & Fees]
    
    G --> I[Patient Dashboard]
    H --> J[Define Weekly Schedule]
    J --> K[Admin Approves/Verifies Doctor]
    K --> L[Doctor Dashboard & Slot Generation]
```

## 2. Appointment Booking Workflow (Patient & Doctor Interaction)

```mermaid
flowchart TD
    A[Patient Logs In] --> B[Search for Doctor]
    B --> C[View Profile, Ratings & Schedule]
    C --> D{Is a Slot Available?}
    
    D -- Yes --> E[Select Slot & Hold Slot]
    D -- No --> B
    
    E --> F[Select Payment Method]
    F --> G{Online or Offline?}
    
    G -- Online Integration --> H[Process Razorpay Transaction]
    G -- Offline --> I[Confirm Pay at Clinic]
    
    H -- Success --> J[Slot Status: BOOKED]
    H -- Failed --> K[Slot Status reverts to AVAILABLE]
    I --> J
    
    J --> L[Appointment Status: PENDING]
    L --> M[Notification sent to Doctor]
    M --> N[Doctor Confirms Appointment -> Status: CONFIRMED]
    
    N --> O[Consultation Occurs]
    O --> P[Doctor Marks Status: COMPLETED]
    P --> Q[Earnings Added to Doctor Balance]
    
    Q --> R[Patient Leaves Rating/Comment]
```

## 3. Doctor Leave & Slot Auto-Management Workflow

```mermaid
flowchart TD
    A[Doctor Accesses Dashboard] --> B[Navigates to Leave Management]
    B --> C[Submits Leave Start & End Date]
    C --> D[System Scans Slots in Leave Bounds]
    
    D --> E{Are there Booked Appointments?}
    
    E -- Yes --> F[System Alerts Doctor of Conflict]
    F --> G[Doctor Confirms Override]
    G --> H[Appointments Auto-Cancelled & Refunded]
    H --> I[Affected Slots Marked: ON_LEAVE]
    
    E -- No --> I
    
    I --> J[Notifications Sent to Affected Patients]
    J --> K[Doctor Schedule Updated Successfully]
```

## 4. Financial & Earnings Withdrawal Workflow

```mermaid
flowchart TD
    A[Doctor Completes Appointment] --> B[System Credits In-App Balance]
    B --> C[Doctor Initiates Withdrawal Request]
    
    C --> D{Is Balance Sufficient?}
    
    D -- Yes --> E[Withdrawal Request created: PENDING]
    D -- No --> F[Throw Error: Minimum Balance Not Met]
    
    E --> G[Admin Reviews & Approves Withdrawal]
    G --> H[Payout Initiated via Gateway Processing]
    
    H -- Success --> I[Withdrawal Status: COMPLETED]
    H -- Failed --> J[Withdrawal Status: FAILED & Balance Refunded]
```

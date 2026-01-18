# Timezone-Aware Date Handling - Corrected Flow

## **The Problem We Fixed**

Previously, the system was storing dates as UTC but interpreting user input as if it were UTC. This caused critical issues:

- User in India (IST = UTC+5:30) inputs "2:00 PM" thinking it's 2 PM local time
- Old system stored this as "2026-01-20T14:00:00.000Z" (2 PM UTC)
- But user actually meant 2 PM IST = 8:30 AM UTC
- Result: Appointments booked at wrong times

## **The Solution: Timezone-Aware Conversion**

Now we properly convert between user's **local timezone** and **UTC**:

```
User Input (Local Time) → Convert to UTC → Store in DB → 
Fetch from DB (UTC) → Convert to Local Time → Display to User
```

---

## **Practical Example: Doctor in India Setting Leave**

### **User's Local Timezone: IST (UTC+5:30)**

### **Step 1: User Inputs Date & Time**
- Browser: User selects "2026-01-20" and "14:00" (2:00 PM in their timezone)
- They think: "I want leave from 2 PM IST on Jan 20"

### **Step 2: Client Converts Local → UTC**
```tsx
import { combineDateTimeInUserTimezone } from '@/lib/dateUtils';

// User input in local timezone
const userInput = {
  date: "2026-01-20",
  time: "14:00"  // 2:00 PM IST
};

// Client utility accounts for timezone offset
// IST = UTC+5:30, so getTimezoneOffset() returns -330 (in minutes)
const utcDate = combineDateTimeInUserTimezone("2026-01-20", "14:00");
// Result: "2026-01-20T08:30:00.000Z" (8:30 AM UTC)

// Send to server
fetch('/api/doctors/{doctorId}/leave', {
  body: JSON.stringify({
    startDate: utcDate.toISOString(),  // "2026-01-20T08:30:00.000Z"
    endDate: endDate.toISOString()
  })
});
```

**Why this works:**
- `combineDateTimeInUserTimezone("2026-01-20", "14:00")` creates a local Date object
- Then converts to UTC by subtracting the timezone offset
- IST user: 2 PM IST → 8:30 AM UTC ✅
- EST user: 2 PM EST → 7 PM UTC ✅

### **Step 3: Server Receives & Stores**
```tsx
// Server receives: "2026-01-20T08:30:00.000Z" (UTC)
const leaveRequest = await prisma.leave.create({
  data: {
    startDate: new Date(body.startDate),  // "2026-01-20T08:30:00.000Z"
    doctorId: doctorId
  }
});

// Database stores: 2026-01-20 08:30:00+00 (UTC)
```

### **Step 4: Display to User (Converting UTC → Local)**
```tsx
import { formatUTCToUserTimezone } from '@/lib/dateUtils';

// Fetch from DB (UTC)
const leave = await prisma.leave.findUnique(...);
// leave.startDate = "2026-01-20T08:30:00.000Z" (UTC)

// Convert back to user's local time
const { date, time } = formatUTCToUserTimezone(leave.startDate);
// Result for IST user:
// date: "2026-01-20"
// time: "14:00"  (2:00 PM IST) ✅

// Display in UI
<p>Leave from: {date} at {time}</p>
// Shows: "Leave from: 2026-01-20 at 14:00"
```

### **What Different Timezone Users See**

All users are viewing the **same moment in UTC time**, but displayed in their local timezone:

```
UTC: 2026-01-20T08:30:00.000Z (stored in DB)

User in India (IST = UTC+5:30):    2026-01-20 14:00 (2:00 PM)
User in USA (EST = UTC-5):         2026-01-20 03:30 (3:30 AM)
User in UK (GMT = UTC+0):          2026-01-20 08:30 (8:30 AM)
```

Each sees their local time, but all are booking the same UTC moment! ✅

---

## **Key Utility Functions**

### **For Client Input (User's Local Time → UTC)**
```tsx
import { combineDateTimeInUserTimezone, getTodayInUserTimezone } from '@/lib/dateUtils';

// Get today's date in user's timezone
const today = getTodayInUserTimezone();  // "2026-01-20" (user's local date)

// Get current time in user's timezone
const now = getCurrentTimeInUserTimezone();  // "14:00" (user's local time)

// Convert user's local input to UTC for server
const utcDateTime = combineDateTimeInUserTimezone("2026-01-20", "14:00");
// Returns Date object ready for .toISOString()
```

### **For Client Display (UTC → User's Local Time)**
```tsx
import { formatUTCToUserTimezone } from '@/lib/dateUtils';

// Receive from server (UTC)
const serverTime = "2026-01-20T08:30:00.000Z";

// Convert to user's local time
const { date, time } = formatUTCToUserTimezone(new Date(serverTime));
// date: "2026-01-20"
// time: "14:00"  (in user's timezone)
```

### **For Server Processing (All UTC)**
```tsx
// Server always works with UTC timestamps
const today = new Date();
today.setUTCHours(0, 0, 0, 0);  // Use UTC methods, not local

// Parse incoming date as UTC
const date = new Date(`${dateStr}T00:00:00.000Z`);

// Calculate dates in UTC
const tomorrow = new Date(today);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
```

---

## **Browser Timezone Detection**

The system automatically detects the user's timezone:

```tsx
// Get timezone offset (e.g., -330 for IST)
const offset = getUserTimezoneOffset();

// Get timezone name (e.g., 'Asia/Kolkata')
const timezone = getUserTimezone();
```

No need to ask the user—it's automatic!

---

## **Summary of Changes**

| Component | Old Behavior | New Behavior |
|-----------|--------------|--------------|
| **Doctor Leave Form** | Adjusted for timezone offset manually | Uses `combineDateTimeInUserTimezone()` |
| **Date Defaults** | `getTodayUTC()` (UTC) | `getTodayInUserTimezone()` (Local) |
| **Display Times** | Already used `toLocaleString()` | Still uses `toLocaleString()` (correct) |
| **Stats Routes** | Used `.setHours()` (local) | Uses `.setUTCHours()` (UTC) |
| **Slot Generation** | Used `.setHours()` (local) | Uses `.setUTCHours()` (UTC) |

---

## **The Flow Diagram**

```
┌─────────────────────────────────────────────────────────────┐
│                    USER IN INDIA (IST)                      │
│                                                              │
│  Input: "2026-01-20" "14:00" (2 PM IST)                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  combineDateTimeInUserTimezone│
        │  (Subtract UTC+5:30 offset)  │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  2026-01-20T08:30:00.000Z    │
        │  (8:30 AM UTC)               │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  Send to API                 │
        │  .toISOString()              │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  PostgreSQL DB (UTC)         │
        │  2026-01-20 08:30:00+00      │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  Fetch from DB               │
        │  "2026-01-20T08:30:00.000Z"  │
        └──────────────┬───────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │  formatUTCToUserTimezone()   │
        │  (Add UTC+5:30 offset)       │
        └──────────────┬───────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    DISPLAY TO USER                          │
│                                                              │
│  Date: "2026-01-20"  Time: "14:00" (2 PM IST) ✅          │
└─────────────────────────────────────────────────────────────┘
```

---

## **Testing the Implementation**

To verify the timezone handling works correctly:

1. **In India (IST = UTC+5:30):**
   - Input: "2 PM"
   - Server receives: 8:30 AM UTC
   - Display: "2 PM"

2. **In USA (EST = UTC-5):**
   - Input: "2 PM"
   - Server receives: 7 PM UTC
   - Display: "2 PM"

Both users see "2 PM" locally, but the server stores different UTC times. This is correct! ✅

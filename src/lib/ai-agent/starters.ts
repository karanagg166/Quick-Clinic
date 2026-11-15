import { AgentRole, AgentStarterPrompt } from "./types";

export const PATIENT_STARTER_PROMPTS: AgentStarterPrompt[] = [
  {
    id: "patient-availability",
    title: "Check doctor slots",
    prompt: "Check available appointments for Cardiology this week.",
    actionType: "CHECK_AVAILABILITY",
    riskLevel: "LOW_AUTONOMOUS",
    description: "Fetches real-time doctor availability and slot timings.",
  },
  {
    id: "patient-book",
    title: "Request an appointment",
    prompt: "Propose a consultation slot for Dr. Sharma tomorrow morning.",
    actionType: "PROPOSE_APPOINTMENT",
    riskLevel: "MEDIUM_HUMAN_APPROVAL",
    description: "Prepares a booking request for confirmation before reserving.",
  },
  {
    id: "patient-medical-rag",
    title: "Search my medical records",
    prompt: "Search my uploaded medical documents for recent lab values and prescriptions.",
    actionType: "ACCESS_MEDICAL_DOCUMENTS",
    riskLevel: "LOW_AUTONOMOUS",
    description: "Retrieves evidence-grounded answers with page-level document citations.",
  },
  {
    id: "patient-history",
    title: "Summarize my visits",
    prompt: "Summarize my upcoming and recent Quick-Clinic appointments.",
    actionType: "SUMMARIZE_VISIT_HISTORY",
    riskLevel: "LOW_AUTONOMOUS",
    description: "Reviews your own visit schedule without exposing private notes.",
  },
];

export const DOCTOR_STARTER_PROMPTS: AgentStarterPrompt[] = [
  {
    id: "doctor-schedule",
    title: "Today's appointments",
    prompt: "List my upcoming appointments and open slots for today.",
    actionType: "CHECK_AVAILABILITY",
    riskLevel: "LOW_AUTONOMOUS",
    description: "Inspects your live doctor schedule, leaves, and booked slots.",
  },
  {
    id: "doctor-clinical-rag",
    title: "Query patient documents",
    prompt: "Check authorized patient medical documents for recent lab values.",
    actionType: "QUERY_CLINICAL_DOCS",
    riskLevel: "LOW_AUTONOMOUS",
    description: "Answers clinical questions with page-level document citations.",
  },
  {
    id: "doctor-leave",
    title: "Apply for leave",
    prompt: "Apply for leave next Friday due to a medical conference.",
    actionType: "APPLY_LEAVE",
    riskLevel: "MEDIUM_HUMAN_APPROVAL",
    description: "Requires your approval before changing your leave.",
  },
  {
    id: "doctor-message-patient",
    title: "Message a patient",
    prompt: "Send a follow-up message to my next scheduled patient.",
    actionType: "SEND_PATIENT_MESSAGE",
    riskLevel: "MEDIUM_HUMAN_APPROVAL",
    description: "Requires explicit doctor approval before sending the message.",
  },
];

export function getStarterPromptsForRole(role: AgentRole): AgentStarterPrompt[] {
  return role === "DOCTOR" ? DOCTOR_STARTER_PROMPTS : PATIENT_STARTER_PROMPTS;
}

export type EmployeeRole =
  | "barber"
  | "radio_host"
  | "admin"
  | "program_staff"
  | "other";

export type EmployeeStatus = "onboarding" | "active" | "inactive";

export interface EmployeePayload {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: EmployeeRole;
  location?: string;
  startDate?: string;
  status?: EmployeeStatus;
  notes?: string;
}

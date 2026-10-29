export type EmployeeProfileDraft = {
  jobTitle: string;
  department: string;
  employmentStartDate: string;
  phone: string;
  address: string;
  dateOfBirth: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export const EMPTY_PROFILE_DRAFT: EmployeeProfileDraft = {
  jobTitle: "",
  department: "",
  employmentStartDate: "",
  phone: "",
  address: "",
  dateOfBirth: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
};

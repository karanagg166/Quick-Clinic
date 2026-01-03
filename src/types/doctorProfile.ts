
export interface DoctorProfileFormData {
    name: string;
    email: string;
    phoneNo: string;
    age: string;
    address: string;
    city: string;
    state: string;
    pinCode: string;
    gender: string;
    role: string;
}

export interface DoctorProfessionalData {
    specialty: string;
    experience: string;
    fees: string;
    qualifications: string[];
    doctorBio: string;
}

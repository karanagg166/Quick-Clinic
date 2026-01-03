
export interface SignupFormData {
    name: string;
    email: string;
    phoneNo: string;
    age: string;
    address: string;
    city: string;
    state: string;
    pinCode: string;
    gender: "MALE" | "FEMALE" | "BINARY" | "";
    password: string;
    confirmPassword: string;
    role: "DOCTOR" | "PATIENT" | "ADMIN";
}

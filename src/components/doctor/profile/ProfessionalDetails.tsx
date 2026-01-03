import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { DoctorProfessionalData } from "@/types/doctorProfile";

interface ProfessionalDetailsProps {
    doctorId: string | null;
    doctorData: DoctorProfessionalData;
    handleDoctorChange: (field: keyof DoctorProfessionalData, value: string) => void;
    toggleQualification: (value: string) => void;
    specialties: string[];
    qualificationsList: string[];
    loadingEnums: boolean;
}

export function ProfessionalDetails({
    doctorId,
    doctorData,
    handleDoctorChange,
    toggleQualification,
    specialties,
    qualificationsList,
    loadingEnums,
}: ProfessionalDetailsProps) {
    return (
        <Card className="shadow-sm">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Professional Details</CardTitle>
                        <p className="text-sm text-muted-foreground">Help patients understand your expertise</p>
                    </div>
                    {doctorId && <Badge variant="outline">Doctor ID: {doctorId}</Badge>}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="specialty">Specialty</Label>
                    <Select
                        value={doctorData.specialty}
                        onValueChange={(value) => handleDoctorChange("specialty", value)}
                    >
                        <SelectTrigger id="specialty">
                            <SelectValue placeholder="Select specialty" />
                        </SelectTrigger>
                        <SelectContent>
                            {(loadingEnums ? [] : specialties).map((sp) => (
                                <SelectItem key={sp} value={sp}>
                                    {sp}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="doctorBio">Professional Bio</Label>
                    <Textarea
                        id="doctorBio"
                        placeholder="Tell patients about yourself, your expertise, and your approach to healthcare..."
                        value={doctorData.doctorBio}
                        onChange={(e) => handleDoctorChange("doctorBio", e.target.value)}
                        rows={4}
                        className="resize-none"
                    />
                    <p className="text-xs text-muted-foreground">
                        A good bio helps patients understand your background and approach to care.
                    </p>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="experience">Experience (years)</Label>
                        <Input
                            id="experience"
                            type="number"
                            value={doctorData.experience}
                            onChange={(e) => handleDoctorChange("experience", e.target.value)}
                            min={0}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="fees">Consultation Fees (₹)</Label>
                        <Input
                            id="fees"
                            type="number"
                            value={doctorData.fees}
                            onChange={(e) => handleDoctorChange("fees", e.target.value)}
                            min={0}
                        />
                    </div>
                </div>

                <div className="space-y-3">
                    <Label>Qualifications</Label>
                    <Card className="p-4 max-h-64 overflow-y-auto border-dashed">
                        <div className="grid md:grid-cols-2 gap-3">
                            {(loadingEnums ? [] : qualificationsList).map((qualification) => (
                                <label key={qualification} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300"
                                        checked={doctorData.qualifications.includes(qualification)}
                                        onChange={() => toggleQualification(qualification)}
                                    />
                                    {qualification}
                                </label>
                            ))}
                            {!loadingEnums && qualificationsList.length === 0 && (
                                <p className="text-sm text-muted-foreground">No qualifications found.</p>
                            )}
                        </div>
                    </Card>

                    {doctorData.qualifications.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {doctorData.qualifications.map((q) => (
                                <Badge key={q} variant="secondary">
                                    {q}
                                </Badge>
                            ))}
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

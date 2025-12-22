"use client";

import {
  MapPin,
  Star,
  Calendar,
  User,
  DollarSign,
} from "lucide-react";
import Link from "next/link";
import type { Doctor } from "@/types/doctor";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Avatar from "@/components/general/Avatar";

export default function DoctorCard({ doctor }: { doctor: Doctor }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start gap-4">
          <Avatar 
            src={doctor.profileImageUrl} 
            name={doctor.name}
            size="lg"
          />
          <div className="flex-1">
            <h2 className="text-xl font-bold mb-1">{doctor.name}</h2>
            <Badge variant="secondary" className="mt-1">
              {doctor.specialty}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <User className="w-4 h-4 text-muted-foreground" />
          <span>Age: {doctor.age} • {doctor.gender}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span>Experience: {doctor.experience} years</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <DollarSign className="w-4 h-4 text-muted-foreground" />
          <span>Fees: ${doctor.fees}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <span>{doctor.city}, {doctor.state}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Star className="w-4 h-4 text-muted-foreground" />
          <span className="text-muted-foreground">
            Qualifications: {doctor.qualifications?.join(", ") ?? "No qualifications listed"}
          </span>
        </div>
      </CardContent>
      <CardFooter>
        <Button asChild variant="outline" className="w-full">
          <Link href={`/patient/doctor/${doctor.id}`}>
            View Profile
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

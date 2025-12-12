"use client";

import { useState, useEffect } from "react";
import { useUserStore } from "@/store/userStore";

export default function DoctorInfo() {
  const { user, doctorId } = useUserStore();
  
  const [fees, setFees] = useState("");
  const [experience, setExperience] = useState("");

  const [specialty, setSpecialty] = useState(""); // selected
  const [specialties, setSpecialties] = useState<string[]>([]); // list

  const [qualification, setQualification] = useState<string[]>([]); // selected
  const [qualifications, setQualifications] = useState<string[]>([]); // list

  const toggleQualification = (value: string) => {
    setQualification((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value) // remove
        : [...prev, value] // add
    );
  };

  const [existingDoctor, setExistingDoctor] = useState(true);
  const [loading, setLoading] = useState(false);

  // GET DOCTOR INFO
  useEffect(() => {
    console.log(user, doctorId);

    const handleGetInfo = async () => {
      try {
        if (!doctorId) {
          console.log("Doctor not created yet.");
          return;
        }
        
        setLoading(true);

        const response = await fetch(`/api/doctors/${doctorId}` , {
          method: "GET" ,
          credentials: "include"}

        );
        const data = await response.json();
        
        if (response.ok) {
          setExistingDoctor(true);
          setFees(String(data.doctor.fees));
          setExperience(String(data.doctor.experience));
          setSpecialty(data.doctor.specialty);
          setQualification(data.doctor.qualifications || []);
        }
        
      } catch (err:any) {
        console.error("Doctor not created yet.");
      } finally {
        setLoading(false);
      }
    };

    handleGetInfo();
  }, [doctorId]);

  // GET ENUM VALUES (qualifications, specializations)
  useEffect(() => {
    const fetchEnums = async () => {
      try {
        const sp = await fetch("/api/doctors/specializations",
          { method: "GET" ,
          credentials: "include"
          }
        );
        const spData = await sp.json();
        if (sp.ok) setSpecialties(spData.specialties);

        const q = await fetch("/api/doctors/qualifications",
          { method: "GET" ,
          credentials: "include"
          }
        );
        const qData = await q.json();
        if (q.ok) setQualifications(qData.qualifications);
      } catch (err:any) {
        console.error("Enum fetch error:"+ err.message);
      }
    };

    fetchEnums();
  }, []);

  // UPDATE DOCTOR INFO
  const handleUpdateInfo = async () => {
    try {
      if (!doctorId) {
        alert("Doctor ID not found");
        return;
      }

      setLoading(true);
      console.log(doctorId);

      const response = await fetch(`/api/doctors/${doctorId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fees: Number(fees),
          specialty,
          experience: Number(experience),
          qualifications: qualification,
        }),
      });

      const data = await response.json();

      console.log(data);

      if (response.ok) {
        alert("Doctor info updated successfully.");
      } else {
        alert("Error updating doctor info: " + data.error);
      }
    } catch (err:any) {
      alert("Error updating doctor info: " + err.message);
    } finally {
      setLoading(false);
    }
  };

 

  return (
    <div className="max-w-lg mx-auto p-6 bg-white shadow-md rounded-lg mt-6">

      <h2 className="text-2xl font-bold mb-4 text-center">
        Doctor Information
      </h2>

      {loading && <p className="text-blue-600">Loading...</p>}


      <textarea
        value={fees}
        onChange={(e) => setFees(e.target.value)}
        placeholder="Fees"
        className="w-full border p-2 mb-3 rounded"
      />

      <textarea
        value={experience}
        onChange={(e) => setExperience(e.target.value)}
        placeholder="Experience"
        className="w-full border p-2 mb-3 rounded"
      />

      <textarea
        value={fees}
        onChange={(e) => setFees(e.target.value)}
        placeholder="Fees"
        className="w-full border p-2 mb-3 rounded"
      />

      <textarea
        value={fees}
        onChange={(e) => setFees(e.target.value)}
        placeholder="Fees"
        className="w-full border p-2 mb-3 rounded"
      />

      

      {/* EXPERIENCE */}
      <label className="block font-semibold mt-3">Experience (years):</label>
      <input
        type="number"
        value={experience}
        onChange={(e) => setExperience(e.target.value)}
        className="w-full border p-2 rounded"
      />

      {/* SPECIALITY — SINGLE SELECT */}
      <label className="block font-semibold mt-3">Specialty:</label>
      <select
        value={specialty}
        onChange={(e) => setSpecialty(e.target.value)}
        className="w-full border p-2 rounded"
      >
        <option value="">Select specialty</option>
        {specialties.map((sp: string) => (
          <option key={sp} value={sp}>
            {sp}
          </option>
        ))}
      </select>

      {/* QUALIFICATIONS — MULTIPLE SELECT */}
      <label className="block font-semibold mt-4">Qualifications:</label>

      <div className="border p-3 rounded max-h-48 overflow-y-auto space-y-2 bg-gray-50">
        {qualifications.map((q: string) => (
          <label key={q} className="flex items-center gap-2 cursor-pointer text-sm">
            
            <input
              type="checkbox"
              value={q}
              checked={qualification.includes(q)}
              onChange={() => toggleQualification(q)}
              className="h-4 w-4"
            />

            <span>{q}</span>
          </label>
        ))}

        {qualifications.length === 0 && (
          <p className="text-gray-500 text-sm">Loading...</p>
        )}
      </div>


      {/* BUTTONS */}
      <div className="mt-6 flex justify-between">
      
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded"
            onClick={handleUpdateInfo}
          >
            Update Info
          </button>
        
      </div>
    </div>
  );
}

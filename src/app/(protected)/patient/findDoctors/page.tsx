'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MapPin, Stethoscope, Star, Calendar } from 'lucide-react';
import Link from 'next/link';

interface Doctor {
  id: string;
  userId: string;
  name: string;
  specialty: string;
  experience: number;
  fees: number;
  qualifications: string[];
  user?: {
    city?: string;
    state?: string;
  };
}

export default function FindDoctorsPage() {
  const router = useRouter();
  const [location, setLocation] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [specializations, setSpecializations] = useState<string[]>([]);

  // Fetch specializations on component mount
  useEffect(() => {
    const fetchSpecializations = async () => {
      try {
        const res = await fetch('/api/doctors/specializations');
        if (res.ok) {
          const data = await res.json();
          setSpecializations(data.specialties || []);
        }
      } catch (error) {
        console.error('Error fetching specializations:', error);
      }
    };
    fetchSpecializations();
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);
    try {
      const res = await fetch(`/api/doctors?location=${location}&specialization=${specialization}`, {
        method: 'GET',
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        setDoctors(data);
      } else {
        console.error('Failed to fetch doctors');
        setDoctors([]);
      }
    } catch (error) {
      console.error('Error fetching doctors:', error);
      setDoctors([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Find Your Preferred Doctor</h1>
        <p className="text-gray-600">Search and book appointments with qualified healthcare professionals</p>
      </div>

      {/* Search and Filter Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          {/* Location Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
              <input
                type="text"
                name="location"
                placeholder="Enter city or location..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          {/* Specialization Filter */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Specialization</label>
            <div className="relative">
              <Stethoscope className="absolute left-3 top-3 w-5 h-5 text-gray-400 pointer-events-none" />
              <select
                name="specialization"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none appearance-none"
              >
                <option value="">All Specializations</option>
                {specializations.map((spec) => (
                  <option key={spec} value={spec}>
                    {spec}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Search Button */}
          <div>
            <button
              onClick={handleSearch}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              <Search className="w-5 h-5" />
              {loading ? 'Searching...' : 'Search Doctors'}
            </button>
          </div>
        </div>
      </div>

      {/* Doctors List */}
      {searched && doctors.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <Stethoscope className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-xl text-gray-600 font-medium">No doctors found</p>
          <p className="text-gray-500 mt-2">Try adjusting your filters or search criteria</p>
        </div>
      ) : searched && doctors.length > 0 ? (
        <div>
          <p className="text-gray-600 mb-6 font-medium">Found {doctors.length} doctor(s)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {doctors.map((doctor: Doctor) => (
              <div
                key={doctor.id}
                onClick={() => router.push(`/patient/doctor/${doctor.id}`)}
                className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow overflow-hidden cursor-pointer"
              >
                {/* Doctor Card Header */}
                <div className="bg-linear-to-r from-blue-500 to-blue-600 p-6 text-white">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-xl font-bold">{doctor.name}</h3>
                      <p className="text-blue-100 flex items-center gap-1 mt-1">
                        <Stethoscope className="w-4 h-4" />
                        {doctor.specialty}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Doctor Card Body */}
                <div className="p-6">
                  {/* Experience */}
                  <div className="mb-4">
                    <p className="text-sm text-gray-600">
                      <span className="font-medium">Experience:</span> {doctor.experience} years
                    </p>
                  </div>

                  {/* Qualifications */}
                  {doctor.qualifications && doctor.qualifications.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-medium text-gray-700 mb-2">Qualifications:</p>
                      <div className="flex flex-wrap gap-2">
                        {doctor.qualifications.map((qual: string) => (
                          <span
                            key={qual}
                            className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded"
                          >
                            {qual}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Location */}
                  {doctor.user?.city && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-600 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-gray-400" />
                        {doctor.user.city}
                        {doctor.user.state && `, ${doctor.user.state}`}
                      </p>
                    </div>
                  )}

                  {/* Consultation Fee */}
                  <div className="bg-blue-50 rounded-lg p-3 mb-4">
                    <p className="text-sm text-gray-600">Consultation Fee</p>
                    <p className="text-2xl font-bold text-blue-600">₹{doctor.fees}</p>
                  </div>

                  {/* View Profile / Book Button */}
                  <Link
                    href={`/patient/doctor/${doctor.id}`}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors text-center block"
                  >
                    View Profile
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : !searched ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <Search className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-xl text-gray-600 font-medium">Start your search</p>
          <p className="text-gray-500 mt-2">Use the filters above to find doctors matching your criteria</p>
        </div>
      ) : null}
    </div>
  );
}

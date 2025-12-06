'use client';

import { useState } from 'react';
import { Search, MapPin, Stethoscope, Star, Calendar, Clock } from 'lucide-react';
import Link from 'next/link';

interface Doctor {
  id: string;
  name: string;
  specialization: string;
  location: string;
  rating: number;
  reviews: number;
  consultationFee: number;
  availability: string;
  image?: string;
  bio?: string;
  isVerified: boolean;
}

export default function FindDoctorsPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([
    {
      id: '1',
      name: 'Dr. Rajesh Kumar',
      specialization: 'Cardiologist',
      location: 'Mumbai, Maharashtra',
      rating: 4.8,
      reviews: 245,
      consultationFee: 500,
      availability: 'Available Tomorrow',
      bio: 'Experienced cardiologist with 15+ years of practice',
      isVerified: true,
    },
    {
      id: '2',
      name: 'Dr. Priya Sharma',
      specialization: 'Pediatrician',
      location: 'Bangalore, Karnataka',
      rating: 4.6,
      reviews: 189,
      consultationFee: 400,
      availability: 'Available Today',
      bio: 'Specialized in child health and development',
      isVerified: true,
    },
    {
      id: '3',
      name: 'Dr. Amit Patel',
      specialization: 'Dermatologist',
      location: 'Delhi, Delhi',
      rating: 4.7,
      reviews: 156,
      consultationFee: 450,
      availability: 'Available in 2 days',
      bio: 'Skin specialist with advanced treatment methods',
      isVerified: true,
    },
  ]);

  const [filters, setFilters] = useState({
    search: '',
    location: '',
    specialization: '',
    sortBy: 'rating',
  });

  const [filteredDoctors, setFilteredDoctors] = useState<Doctor[]>(doctors);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const updatedFilters = { ...filters, [name]: value };
    setFilters(updatedFilters);
    applyFilters(updatedFilters);
  };

  const applyFilters = (currentFilters: typeof filters) => {
    let results = doctors.filter((doctor) => {
      const matchSearch = doctor.name.toLowerCase().includes(currentFilters.search.toLowerCase()) ||
        doctor.specialization.toLowerCase().includes(currentFilters.search.toLowerCase());
      const matchLocation = !currentFilters.location || doctor.location.toLowerCase().includes(currentFilters.location.toLowerCase());
      const matchSpecialization = !currentFilters.specialization || doctor.specialization.toLowerCase() === currentFilters.specialization.toLowerCase();

      return matchSearch && matchLocation && matchSpecialization;
    });

    // Sort results
    if (currentFilters.sortBy === 'rating') {
      results.sort((a, b) => b.rating - a.rating);
    } else if (currentFilters.sortBy === 'fee') {
      results.sort((a, b) => a.consultationFee - b.consultationFee);
    }

    setFilteredDoctors(results);
  };

  const specializations = ['Cardiologist', 'Pediatrician', 'Dermatologist', 'Neurologist', 'Orthopedic'];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Find Your Preferred Doctor</h1>
        <p className="text-gray-600">Search and book appointments with qualified healthcare professionals</p>
      </div>

      {/* Search and Filter Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="text"
              name="search"
              placeholder="Search by name or specialization..."
              value={filters.search}
              onChange={handleFilterChange}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>

          {/* Location Filter */}
          <div className="relative">
            <MapPin className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
            <input
              type="text"
              name="location"
              placeholder="Enter location..."
              value={filters.location}
              onChange={handleFilterChange}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>

          {/* Specialization Filter */}
          <div>
            <select
              name="specialization"
              value={filters.specialization}
              onChange={handleFilterChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="">All Specializations</option>
              {specializations.map((spec) => (
                <option key={spec} value={spec}>
                  {spec}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By */}
          <div>
            <select
              name="sortBy"
              value={filters.sortBy}
              onChange={handleFilterChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="rating">Sort by Rating</option>
              <option value="fee">Sort by Fee (Low to High)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Doctors List */}
      {filteredDoctors.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-12 text-center">
          <Stethoscope className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <p className="text-xl text-gray-600 font-medium">No doctors found</p>
          <p className="text-gray-500 mt-2">Try adjusting your filters or search criteria</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredDoctors.map((doctor) => (
            <div key={doctor.id} className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow overflow-hidden">
              {/* Doctor Card Header */}
              <div className="bg-linear-to-r from-blue-500 to-blue-600 p-6 text-white">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold">{doctor.name}</h3>
                    <p className="text-blue-100 flex items-center gap-1 mt-1">
                      <Stethoscope className="w-4 h-4" />
                      {doctor.specialization}
                    </p>
                  </div>
                  {doctor.isVerified && (
                    <div className="bg-white bg-opacity-20 px-3 py-1 rounded-full text-sm font-medium">
                      ✓ Verified
                    </div>
                  )}
                </div>
              </div>

              {/* Doctor Card Body */}
              <div className="p-6">
                {/* Bio */}
                <p className="text-gray-600 text-sm mb-4">{doctor.bio}</p>

                {/* Rating and Reviews */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="flex items-center">
                    {[...Array(5)].map((_, i) => (
                      <Star
                        key={i}
                        className={`w-4 h-4 ${
                          i < Math.floor(doctor.rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
                        }`}
                      />
                    ))}
                  </div>
                  <span className="text-sm font-medium text-gray-900">{doctor.rating}</span>
                  <span className="text-sm text-gray-500">({doctor.reviews} reviews)</span>
                </div>

                {/* Location and Fee */}
                <div className="space-y-2 mb-4">
                  <p className="text-sm text-gray-600 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    {doctor.location}
                  </p>
                  <p className="text-sm text-gray-600 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    {doctor.availability}
                  </p>
                </div>

                {/* Consultation Fee */}
                <div className="bg-blue-50 rounded-lg p-3 mb-4">
                  <p className="text-sm text-gray-600">Consultation Fee</p>
                  <p className="text-2xl font-bold text-blue-600">₹{doctor.consultationFee}</p>
                </div>

                {/* Book Button */}
                <Link
                  href={`/patient/book-appointment/${doctor.id}`}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors text-center"
                >
                  Book Appointment
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
export default function DoctorDashboard() {
  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Doctor Dashboard</h2>
      <p>Welcome to your doctor dashboard! Here you can manage your schedule, view appointments, and track patient interactions.</p>
      
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Quick Stats Cards */}
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-600">
          <h3 className="text-sm font-medium text-gray-500">Today's Appointments</h3>
          <p className="text-3xl font-bold text-blue-600 mt-2">5</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-600">
          <h3 className="text-sm font-medium text-gray-500">Total Patients</h3>
          <p className="text-3xl font-bold text-green-600 mt-2">142</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-purple-600">
          <h3 className="text-sm font-medium text-gray-500">This Month's Earnings</h3>
          <p className="text-3xl font-bold text-purple-600 mt-2">₹45,000</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-yellow-600">
          <h3 className="text-sm font-medium text-gray-500">Pending Leaves</h3>
          <p className="text-3xl font-bold text-yellow-600 mt-2">2</p>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="text-xl font-semibold mb-4">Recent Appointments</h3>
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Patient Name</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Date & Time</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Status</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b hover:bg-gray-50">
                <td className="px-6 py-4 text-sm text-gray-700">John Smith</td>
                <td className="px-6 py-4 text-sm text-gray-700">Dec 7, 2025 - 10:00 AM</td>
                <td className="px-6 py-4">
                  <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">Confirmed</span>
                </td>
                <td className="px-6 py-4">
                  <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">View</button>
                </td>
              </tr>
              <tr className="border-b hover:bg-gray-50">
                <td className="px-6 py-4 text-sm text-gray-700">Sarah Johnson</td>
                <td className="px-6 py-4 text-sm text-gray-700">Dec 7, 2025 - 11:30 AM</td>
                <td className="px-6 py-4">
                  <span className="inline-block px-3 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">Pending</span>
                </td>
                <td className="px-6 py-4">
                  <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">View</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

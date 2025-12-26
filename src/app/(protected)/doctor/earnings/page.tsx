"use client";

import { useState, useEffect } from "react";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";
import EarningsChart from "@/components/doctor/EarningsChart";
import EmptyState from "@/components/general/EmptyState";
import { Wallet, CreditCard, ArrowDownCircle, History } from "lucide-react";
import EnhancedSkeleton from "@/components/general/EnhancedSkeleton";
import StatusBadge from "@/components/general/StatusBadge";

interface BankDetails {
  bankAccountNumber: string | null;
  bankIFSC: string | null;
  bankAccountHolderName: string | null;
  bankName: string | null;
}

interface Withdrawal {
  id: string;
  amount: number;
  amountInRupees: number;
  currency: string;
  status: string;
  bankAccountNumber: string;
  bankIFSC: string;
  bankAccountHolderName: string;
  bankName: string;
  razorpayPayoutId: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export default function DoctorEarnings() {
  const doctorId = useUserStore((s) => s.doctorId);

  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
  });

  const [data, setData] = useState<{ count: number; total: number; earnings?: Array<{ id: string; earned: number; patientName: string; appointmentDateTime: string }> } | null>(null);
  const [loading, setLoading] = useState(false);
  
  // Balance and wallet state
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  const [loadingBankDetails, setLoadingBankDetails] = useState(true);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(true);
  
  // Form states
  const [showBankForm, setShowBankForm] = useState(false);
  const [showWithdrawalForm, setShowWithdrawalForm] = useState(false);
  const [savingBankDetails, setSavingBankDetails] = useState(false);
  const [creatingWithdrawal, setCreatingWithdrawal] = useState(false);
  
  const [bankForm, setBankForm] = useState({
    bankAccountNumber: "",
    bankIFSC: "",
    bankAccountHolderName: "",
    bankName: "",
  });
  
  const [withdrawalAmount, setWithdrawalAmount] = useState("");

  const fetchEarnings = async () => {
    if (!doctorId) return;

    setLoading(true);

    const params = new URLSearchParams();

    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);
    if (filters.startTime) params.append("startTime", filters.startTime);
    if (filters.endTime) params.append("endTime", filters.endTime);

    const res = await fetch(`/api/doctors/${doctorId}/earnings?${params.toString()}`);
    const json = await res.json();

    if (res.ok) setData(json);
    else showToast.error(json.error || "Failed to fetch earnings");

    setLoading(false);
  };

  // Fetch balance
  const fetchBalance = async () => {
    if (!doctorId) return;
    try {
      setLoadingBalance(true);
      const response = await fetch(`/api/doctors/${doctorId}/balance`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setBalance(data.balanceInRupees);
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setLoadingBalance(false);
    }
  };

  // Fetch bank details
  const fetchBankDetails = async () => {
    if (!doctorId) return;
    try {
      setLoadingBankDetails(true);
      const response = await fetch(`/api/doctors/${doctorId}/bank-details`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setBankDetails(data);
        if (data.bankAccountNumber) {
          setBankForm({
            bankAccountNumber: data.bankAccountNumber,
            bankIFSC: data.bankIFSC || "",
            bankAccountHolderName: data.bankAccountHolderName || "",
            bankName: data.bankName || "",
          });
        }
      }
    } catch (error) {
      console.error('Failed to fetch bank details:', error);
    } finally {
      setLoadingBankDetails(false);
    }
  };

  // Fetch withdrawals
  const fetchWithdrawals = async () => {
    if (!doctorId) return;
    try {
      setLoadingWithdrawals(true);
      const response = await fetch(`/api/doctors/${doctorId}/withdrawals`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setWithdrawals(data);
      }
    } catch (error) {
      console.error('Failed to fetch withdrawals:', error);
    } finally {
      setLoadingWithdrawals(false);
    }
  };

  // Save bank details
  const handleSaveBankDetails = async () => {
    if (!doctorId) return;
    
    if (!bankForm.bankAccountNumber || !bankForm.bankIFSC || !bankForm.bankAccountHolderName || !bankForm.bankName) {
      showToast.warning('Please fill all bank details');
      return;
    }

    try {
      setSavingBankDetails(true);
      const response = await fetch(`/api/doctors/${doctorId}/bank-details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bankForm),
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save bank details');
      }

      showToast.success('Bank details saved successfully');
      setShowBankForm(false);
      await fetchBankDetails();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save bank details';
      showToast.error(errorMessage);
    } finally {
      setSavingBankDetails(false);
    }
  };

  // Create withdrawal
  const handleCreateWithdrawal = async () => {
    if (!doctorId) return;
    
    const amount = parseFloat(withdrawalAmount);
    if (isNaN(amount) || amount <= 0) {
      showToast.warning('Please enter a valid amount');
      return;
    }

    if (amount < 100) {
      showToast.warning('Minimum withdrawal amount is ₹100');
      return;
    }

    if (!bankDetails?.bankAccountNumber) {
      showToast.warning('Please add bank details first');
      setShowBankForm(true);
      return;
    }

    try {
      setCreatingWithdrawal(true);
      const response = await fetch(`/api/doctors/${doctorId}/withdrawals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create withdrawal request');
      }

      showToast.success('Withdrawal request created successfully');
      setWithdrawalAmount("");
      setShowWithdrawalForm(false);
      await fetchBalance();
      await fetchWithdrawals();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create withdrawal request';
      showToast.error(errorMessage);
    } finally {
      setCreatingWithdrawal(false);
    }
  };

  useEffect(() => {
    if (!doctorId) return;
    fetchEarnings();
    fetchBalance();
    fetchBankDetails();
    fetchWithdrawals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId]);

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Earnings & Wallet</h1>
        <p className="text-muted-foreground">Manage your earnings, balance, and withdrawals</p>
      </div>

      {/* Balance Card */}
      <Card className="border shadow-sm bg-gradient-to-r from-green-50 to-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            Current Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingBalance ? (
            <Skeleton className="h-12 w-48" />
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-4xl font-bold text-green-700">
                  ₹{balance !== null ? balance.toFixed(2) : '0.00'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Available for withdrawal
                </p>
              </div>
              <Button
                onClick={() => {
                  if (!bankDetails?.bankAccountNumber) {
                    setShowBankForm(true);
                    showToast.warning('Please add bank details first');
                  } else {
                    setShowWithdrawalForm(true);
                  }
                }}
                disabled={!balance || balance < 100}
                className="bg-green-600 hover:bg-green-700"
              >
                <ArrowDownCircle className="w-4 h-4 mr-2" />
                Withdraw
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bank Details Card */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            Bank Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingBankDetails ? (
            <Skeleton className="h-32" />
          ) : bankDetails?.bankAccountNumber ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Account Holder</Label>
                  <p className="font-medium">{bankDetails.bankAccountHolderName}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Account Number</Label>
                  <p className="font-medium">****{bankDetails.bankAccountNumber.slice(-4)}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">IFSC Code</Label>
                  <p className="font-medium">{bankDetails.bankIFSC}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Bank Name</Label>
                  <p className="font-medium">{bankDetails.bankName}</p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setShowBankForm(true)}
                className="mt-4"
              >
                Update Bank Details
              </Button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground mb-4">
                Add your bank details to enable withdrawals
              </p>
              <Button onClick={() => setShowBankForm(true)}>
                Add Bank Details
              </Button>
            </div>
          )}

          {/* Bank Details Form */}
          {showBankForm && (
            <div className="mt-4 p-4 border rounded-lg space-y-4 bg-gray-50">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="bankName">Bank Name *</Label>
                  <Input
                    id="bankName"
                    value={bankForm.bankName}
                    onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })}
                    placeholder="e.g., State Bank of India"
                  />
                </div>
                <div>
                  <Label htmlFor="accountHolder">Account Holder Name *</Label>
                  <Input
                    id="accountHolder"
                    value={bankForm.bankAccountHolderName}
                    onChange={(e) => setBankForm({ ...bankForm, bankAccountHolderName: e.target.value })}
                    placeholder="Account holder name"
                  />
                </div>
                <div>
                  <Label htmlFor="accountNumber">Account Number *</Label>
                  <Input
                    id="accountNumber"
                    value={bankForm.bankAccountNumber}
                    onChange={(e) => setBankForm({ ...bankForm, bankAccountNumber: e.target.value })}
                    placeholder="Account number"
                    type="text"
                  />
                </div>
                <div>
                  <Label htmlFor="ifsc">IFSC Code *</Label>
                  <Input
                    id="ifsc"
                    value={bankForm.bankIFSC}
                    onChange={(e) => setBankForm({ ...bankForm, bankIFSC: e.target.value.toUpperCase() })}
                    placeholder="e.g., SBIN0001234"
                    maxLength={11}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleSaveBankDetails}
                  disabled={savingBankDetails}
                  className="flex-1"
                >
                  {savingBankDetails ? 'Saving...' : 'Save Bank Details'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowBankForm(false);
                    fetchBankDetails();
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Withdrawal Form */}
          {showWithdrawalForm && (
            <div className="mt-4 p-4 border rounded-lg space-y-4 bg-gray-50">
              <div>
                <Label htmlFor="withdrawalAmount">Withdrawal Amount (₹) *</Label>
                <Input
                  id="withdrawalAmount"
                  type="number"
                  value={withdrawalAmount}
                  onChange={(e) => setWithdrawalAmount(e.target.value)}
                  placeholder="Enter amount (minimum ₹100)"
                  min="100"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Minimum withdrawal: ₹100
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleCreateWithdrawal}
                  disabled={creatingWithdrawal || !withdrawalAmount || parseFloat(withdrawalAmount) < 100}
                  className="flex-1"
                >
                  {creatingWithdrawal ? 'Processing...' : 'Request Withdrawal'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowWithdrawalForm(false);
                    setWithdrawalAmount("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Withdrawal History */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Withdrawal History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingWithdrawals ? (
            <Skeleton className="h-32" />
          ) : withdrawals.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No withdrawal requests yet
            </p>
          ) : (
            <div className="space-y-4">
              {withdrawals.map((withdrawal) => (
                <div
                  key={withdrawal.id}
                  className="p-4 border rounded-lg flex items-center justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="font-semibold">₹{withdrawal.amountInRupees.toFixed(2)}</p>
                      <StatusBadge status={withdrawal.status.toLowerCase()} showIcon={true} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(withdrawal.createdAt).toLocaleString()}
                    </p>
                    {withdrawal.failureReason && (
                      <p className="text-xs text-red-600 mt-1">
                        Reason: {withdrawal.failureReason}
                      </p>
                    )}
                  </div>
                  {withdrawal.razorpayPayoutId && (
                    <p className="text-xs text-muted-foreground">
                      Payout ID: {withdrawal.razorpayPayoutId}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Filter Earnings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* Start Date */}
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={filters.startDate || ""}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={filters.endDate || ""}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </div>

            {/* Start Time */}
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time</Label>
              <Input
                id="startTime"
                type="time"
                value={filters.startTime || ""}
                onChange={(e) => setFilters({ ...filters, startTime: e.target.value })}
              />
            </div>

            {/* End Time */}
            <div className="space-y-2">
              <Label htmlFor="endTime">End Time</Label>
              <Input
                id="endTime"
                type="time"
                value={filters.endTime || ""}
                onChange={(e) => setFilters({ ...filters, endTime: e.target.value })}
              />
            </div>

            {/* Filter Button */}
            <div className="flex items-end">
              <Button
                onClick={fetchEarnings}
                disabled={loading}
                className="w-full"
              >
                {loading ? "Loading..." : "Filter"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {loading && (
        <div className="space-y-6">
          <EnhancedSkeleton variant="card" />
          <EnhancedSkeleton variant="card" />
        </div>
      )}

      {/* No Results */}
      {!loading && data?.count === 0 && (
        <EmptyState
          icon={Wallet}
          title="No earnings found"
          description="No earnings found for the selected filters. Try adjusting your date range or check back later."
        />
      )}

      {/* Stats and Charts */}
      {!loading && data && data.count > 0 && (
        <div className="space-y-6">
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle>Earnings Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center space-y-2">
                <p className="text-lg text-muted-foreground">
                  Total Appointments: <span className="font-semibold text-foreground">{data.count}</span>
                </p>
                <p className="text-3xl font-semibold text-foreground">
                  Total Earnings: ₹{data.total.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Charts */}
          {data.earnings && data.earnings.length > 0 && (
            <EarningsChart data={{ earnings: data.earnings }} />
          )}
        </div>
      )}
    </div>
  );
}

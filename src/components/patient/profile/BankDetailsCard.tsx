"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showToast } from "@/lib/toast";
import { CreditCard, CheckCircle2, Building2 } from "lucide-react";

interface BankDetailsCardProps {
  userId: string | undefined;
}

export function BankDetailsCard({ userId }: BankDetailsCardProps) {
  const [bankDetails, setBankDetails] = useState<{
    bankAccountNumber: string | null;
    bankIFSC: string | null;
    bankAccountHolderName: string | null;
    bankName: string | null;
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    bankAccountNumber: "",
    bankIFSC: "",
    bankAccountHolderName: "",
    bankName: "",
  });

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    const fetchBankDetails = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/user/${userId}/bank-details`);
        if (res.ok) {
          const data = await res.json();
          setBankDetails(data);
          if (data.bankAccountNumber) {
            setForm({
              bankAccountNumber: data.bankAccountNumber || "",
              bankIFSC: data.bankIFSC || "",
              bankAccountHolderName: data.bankAccountHolderName || "",
              bankName: data.bankName || "",
            });
          } else {
            setEditing(false);
          }
        }
      } catch (e) {
        console.error("Failed to load bank details:", e);
      } finally {
        setLoading(false);
      }
    };

    fetchBankDetails();
  }, [userId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || saving) return;

    // Validate IFSC format
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(form.bankIFSC.toUpperCase().trim())) {
      showToast.error("Please enter a valid 11-digit IFSC code (e.g. HDFC0001234)");
      return;
    }

    // Validate Account Number
    if (!/^\d{9,18}$/.test(form.bankAccountNumber.trim())) {
      showToast.error("Please enter a valid 9-18 digit account number");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`/api/user/${userId}/bank-details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to save bank details");
      }

      const data = await res.json();
      setBankDetails(data.bankDetails);
      setEditing(false);
      showToast.success("Bank details saved successfully");
    } catch (err: any) {
      showToast.error(err?.message || "Failed to save bank details");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-5 bg-gray-200 rounded w-1/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-blue-600" />
            Bank & Refund Details
          </CardTitle>
          <CardDescription>
            Saved account details for receiving direct refunds and claims securely.
          </CardDescription>
        </div>
        {!editing && bankDetails?.bankAccountNumber && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit Details
          </Button>
        )}
      </CardHeader>

      <CardContent>
        {editing || !bankDetails?.bankAccountNumber ? (
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bankAccountHolderName">Account Holder Name</Label>
                <Input
                  id="bankAccountHolderName"
                  placeholder="Full name as on bank passbook"
                  value={form.bankAccountHolderName}
                  onChange={(e) => setForm({ ...form, bankAccountHolderName: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bankName">Bank Name</Label>
                <Input
                  id="bankName"
                  placeholder="e.g. State Bank of India, HDFC Bank"
                  value={form.bankName}
                  onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="bankAccountNumber">Account Number</Label>
                <Input
                  id="bankAccountNumber"
                  placeholder="9-18 digit account number"
                  value={form.bankAccountNumber}
                  onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="bankIFSC">IFSC Code</Label>
                <Input
                  id="bankIFSC"
                  placeholder="11-character IFSC (e.g. SBIN0001234)"
                  value={form.bankIFSC}
                  onChange={(e) => setForm({ ...form, bankIFSC: e.target.value.toUpperCase() })}
                  maxLength={11}
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Bank Details"}
              </Button>
              {bankDetails?.bankAccountNumber && (
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        ) : (
          <div className="bg-slate-50 border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-700 font-medium text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Bank Account Linked for Refunds</span>
              </div>
              <Building2 className="w-5 h-5 text-gray-400" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm pt-2">
              <div>
                <p className="text-xs text-muted-foreground">Account Holder</p>
                <p className="font-semibold">{bankDetails.bankAccountHolderName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Bank Name</p>
                <p className="font-semibold">{bankDetails.bankName}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Account Number</p>
                <p className="font-semibold">•••• •••• {bankDetails.bankAccountNumber?.slice(-4)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">IFSC Code</p>
                <p className="font-semibold">{bankDetails.bankIFSC}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

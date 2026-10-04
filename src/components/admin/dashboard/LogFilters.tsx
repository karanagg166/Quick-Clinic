"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RotateCcw } from "lucide-react";

interface LogFiltersProps {
    onFilterChange: (filters: any) => void;
    loading: boolean;
}

export function LogFilters({ onFilterChange, loading }: LogFiltersProps) {
    const [type, setType] = useState("audit");
    const [scope, setScope] = useState("all");
    const [tag, setTag] = useState("all");
    const [action, setAction] = useState("");

    const handleTypeChange = (val: string) => {
        setType(val);
        onFilterChange({ type: val });
    };

    const handleScopeChange = (val: string) => {
        setScope(val);
        onFilterChange({ scope: val });
    };

    const handleTagChange = (val: string) => {
        setTag(val);
        onFilterChange({ tag: val === "all" ? "" : val });
    };

    const handleActionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setAction(val);
        onFilterChange({ action: val });
    };

    const handleActionSelect = (val: string) => {
        const selected = val === "all" ? "" : val;
        setAction(selected);
        onFilterChange({ action: selected });
    };

    const handleReset = () => {
        setType("audit");
        setScope("all");
        setTag("all");
        setAction("");
        onFilterChange({ type: "audit", scope: "all", tag: "", action: "" });
    };

    return (
        <div className="flex flex-wrap gap-4 mb-6 items-end">
            <div className="space-y-1.5 w-full sm:w-auto min-w-[130px]">
                <Label className="text-xs font-medium">Log Type</Label>
                <Select value={type} onValueChange={handleTypeChange}>
                    <SelectTrigger className="w-full text-xs">
                        <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="audit">Audit Logs</SelectItem>
                        <SelectItem value="access">Access Logs</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1.5 w-full sm:w-auto min-w-[130px]">
                <Label className="text-xs font-medium">Scope</Label>
                <Select value={scope} onValueChange={handleScopeChange}>
                    <SelectTrigger className="w-full text-xs">
                        <SelectValue placeholder="Scope" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        <SelectItem value="my">My Logs</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1.5 w-full sm:w-auto min-w-[160px]">
                <Label className="text-xs font-medium">Category / Tag</Label>
                <Select value={tag} onValueChange={handleTagChange}>
                    <SelectTrigger className="w-full text-xs">
                        <SelectValue placeholder="Filter by Tag" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Tags</SelectItem>
                        <SelectItem value="MEDICAL_RECORD">Medical Records</SelectItem>
                        <SelectItem value="SYSTEM">System</SelectItem>
                        <SelectItem value="AUTH">Authentication</SelectItem>
                        <SelectItem value="SECURITY">Security</SelectItem>
                        <SelectItem value="PAYMENT">Payment</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1.5 w-full sm:w-auto min-w-[180px]">
                <Label className="text-xs font-medium">Action Preset</Label>
                <Select onValueChange={handleActionSelect}>
                    <SelectTrigger className="w-full text-xs">
                        <SelectValue placeholder="Select Action Preset" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Actions</SelectItem>
                        <SelectItem value="MEDICAL_DOCUMENT_VIEW">MEDICAL_DOCUMENT_VIEW</SelectItem>
                        <SelectItem value="MEDICAL_DOCUMENT_DOWNLOAD">MEDICAL_DOCUMENT_DOWNLOAD</SelectItem>
                        <SelectItem value="MEDICAL_DOCUMENT_LIST">MEDICAL_DOCUMENT_LIST</SelectItem>
                        <SelectItem value="MEDICAL_DOCUMENT_ACCESS_DENIED">MEDICAL_DOCUMENT_ACCESS_DENIED</SelectItem>
                        <SelectItem value="MEDICAL_DOCUMENT_UPLOAD">MEDICAL_DOCUMENT_UPLOAD</SelectItem>
                        <SelectItem value="MEDICAL_DOCUMENT_DELETE">MEDICAL_DOCUMENT_DELETE</SelectItem>
                        <SelectItem value="MEDICAL_DOCUMENT_UPDATE">MEDICAL_DOCUMENT_UPDATE</SelectItem>
                        <SelectItem value="MEDICAL_DOCUMENT_RETRY_PROCESSING">MEDICAL_DOCUMENT_RETRY_PROCESSING</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-1.5 flex-1 min-w-[180px]">
                <Label className="text-xs font-medium">Action Filter</Label>
                <Input
                    placeholder="Search action name..."
                    value={action}
                    onChange={handleActionChange}
                    className="text-xs"
                />
            </div>

            <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={loading}
                className="text-xs gap-1.5 h-9"
            >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
            </Button>
        </div>
    );
}

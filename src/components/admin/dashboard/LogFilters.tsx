"use client";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

interface LogFiltersProps {
    onFilterChange: (filters: any) => void;
    loading: boolean;
}

export function LogFilters({ onFilterChange, loading }: LogFiltersProps) {
    const handleScopeChange = (scope: string) => {
        onFilterChange({ scope });
    };

    const handleTypeChange = (type: string) => {
        onFilterChange({ type });
    };

    return (
        <div className="flex flex-col md:flex-row gap-4 mb-6 items-end">
            <div className="space-y-2 w-full md:w-auto">
                <Label>Log Type</Label>
                <Select defaultValue="audit" onValueChange={handleTypeChange}>
                    <SelectTrigger className="w-full md:w-[150px]">
                        <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="audit">Audit Logs</SelectItem>
                        <SelectItem value="access">Access Logs</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2 w-full md:w-auto">
                <Label>Scope</Label>
                <Select defaultValue="all" onValueChange={handleScopeChange}>
                    <SelectTrigger className="w-full md:w-[150px]">
                        <SelectValue placeholder="Scope" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        <SelectItem value="my">My Logs</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* More filters can be added here like date range, user search etc */}

            <div className="flex-1"></div>
        </div>
    );
}

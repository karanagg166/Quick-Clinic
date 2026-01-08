import { Stethoscope } from "lucide-react";

export default function Logo({ className = "", iconClassName = "w-5 h-5" }: { className?: string; iconClassName?: string }) {
    return (
        <div className={`flex items-center gap-2 ${className}`}>
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Stethoscope className={`${iconClassName} text-white`} />
            </div>
            <span className="text-xl font-bold text-gray-900">QuickClinic</span>
        </div>
    );
}

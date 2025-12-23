"use client";

export default function Watermark() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <div className="absolute bottom-8 right-8 opacity-[0.03] select-none">
        <div className="text-7xl md:text-9xl font-bold text-foreground tracking-wider transform -rotate-12">
          QuickClinic
        </div>
      </div>
    </div>
  );
}


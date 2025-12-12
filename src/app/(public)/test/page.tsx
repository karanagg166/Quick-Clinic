"use client";

import { useRef, useEffect } from "react";

export default function TestUseRefPage() {
  // useRef initializes and stores a value without re-rendering the component
  const countRef = useRef<number>(0);

  const handleIncrement = () => {
    countRef.current += 1;
    console.log("Button clicked. Updated ref:", countRef.current);
  };

  // useEffect runs only once on mount
  useEffect(() => {
    console.log("Component mounted. Initial countRef:", countRef.current);
  }, [countRef]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">useRef Count Example</h1>

      <p className="text-lg mb-4">
        Current Count (from ref): <strong>{countRef.current}</strong>
      </p>

      <button
        onClick={handleIncrement}
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        Increment Count
      </button>
    </div>
  );
}

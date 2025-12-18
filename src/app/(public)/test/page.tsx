"use client";

import { useRef, useEffect, useState } from "react";

export default function TestUseRefPage() {
  
  // DOM access: hold a reference to the input element
  const inputRef = useRef<HTMLInputElement | null>(null);
  
  

  // Focus the input using the DOM ref, without re-rendering
  const focusInput = () => {
    inputRef.current?.focus();
  };

  const clearInput = () => {
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
  };

 

  return (
    <div className="p-6">
      {/* 1) Access DOM elements directly via useRef */}
      <h1 className="text-2xl font-bold mb-2">useRef DOM Access Example</h1>
      <p className="text-sm text-gray-600 mb-4">
        This demonstrates the primary use case of <code>useRef</code>: holding a
        persistent reference to a DOM element. Clicking the button calls
        <code>inputRef.current.focus()</code> without triggering a re-render.
      </p>
      <div className="flex items-center gap-3 mb-8">
        <input
          ref={inputRef}
          type="text"
          placeholder="Type something..."
          className="border rounded px-3 py-2 w-72"
        />
        <button
          onClick={focusInput}
          className="bg-green-600 text-white px-4 py-2 rounded"
        >
          Focus Input
        </button>
        <button
          onClick={clearInput}
          className="bg-gray-700 text-white px-4 py-2 rounded"
        >
          Clear & Focus
        </button>
      </div>

      
    </div>
  );
}

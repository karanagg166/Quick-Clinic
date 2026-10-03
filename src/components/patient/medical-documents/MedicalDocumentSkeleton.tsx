"use client";

import React from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface MedicalDocumentSkeletonProps {
  count?: number;
}

export function MedicalDocumentSkeleton({
  count = 6,
}: MedicalDocumentSkeletonProps) {
  return (
    <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, index) => (
        <Card
          key={`skeleton-${index}`}
          className="overflow-hidden border shadow-xs flex flex-col justify-between"
        >
          <div>
            {/* Preview skeleton */}
            <Skeleton className="h-44 w-full rounded-none" />

            <CardHeader className="p-4 pb-2 space-y-2">
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-3.5 w-1/2" />
              <div className="flex gap-2 pt-1">
                <Skeleton className="h-4 w-20 rounded-full" />
                <Skeleton className="h-4 w-14 rounded-full" />
              </div>
            </CardHeader>

            <CardContent className="p-4 pt-1 pb-3 space-y-2">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3.5 w-1/2" />
            </CardContent>
          </div>

          <CardFooter className="p-4 pt-2 border-t flex justify-between gap-2">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 w-24" />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}


"use client";

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
      <Card className="w-full max-w-md text-center border shadow-sm">
        <CardHeader>
          <Badge variant="destructive" className="mx-auto mb-2">Access Denied</Badge>
          <CardTitle className="text-3xl font-semibold">Error 403: Unauthorized</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground">
            You do not have permission to view this page. If you believe this is an error, try signing in again or reach out to support.
          </p>
          <Button asChild className="w-full">
            <Link href="/">
              Go back home
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
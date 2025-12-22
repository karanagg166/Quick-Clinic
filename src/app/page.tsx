"use client";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function Home() {
  const router = useRouter();

  const handleSignup = () => {
    router.push("/auth/signup");
  };

  const handleLogin = () => {
    router.push("/auth/login");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="text-3xl mb-3">
            Welcome to QuickClinic
          </CardTitle>
          <CardDescription className="text-base">
            Login or Signup to continue
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button
            onClick={handleLogin}
            size="lg"
            className="w-full"
          >
            Login
          </Button>
          <Button
            onClick={handleSignup}
            variant="secondary"
            size="lg"
            className="w-full"
          >
            Signup
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

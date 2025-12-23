import LoadingSpinner from "@/components/general/LoadingSpinner";

export default function ProtectedLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LoadingSpinner />
    </div>
  );
}


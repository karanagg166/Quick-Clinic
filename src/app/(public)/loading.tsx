import LoadingSpinner from "@/components/general/LoadingSpinner";

export default function PublicLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LoadingSpinner />
    </div>
  );
}


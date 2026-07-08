import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex h-[calc(100vh-8rem)] w-full flex-col items-center justify-center space-y-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-primary mb-2">404</h1>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-[500px]">
          The page you are looking for does not exist or has been moved.
        </p>
      </div>
      <Link href="/dashboard">
        <Button variant="default">Return to Dashboard</Button>
      </Link>
    </div>
  );
}

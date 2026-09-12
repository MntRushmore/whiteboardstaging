"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-600">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <CardTitle>Something went wrong</CardTitle>
          <CardDescription>
            The page hit an unexpected error. Your board is saved automatically,
            so nothing should be lost. You can try again or head back home.
          </CardDescription>
        </CardHeader>
        {error.digest && (
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Reference: <code className="font-mono">{error.digest}</code>
            </p>
          </CardContent>
        )}
        <CardFooter className="flex gap-2">
          <Button onClick={() => reset()}>
            <RotateCcw />
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">
              <Home />
              Go home
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

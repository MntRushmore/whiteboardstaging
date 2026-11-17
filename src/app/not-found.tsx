import Link from "next/link";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

export const metadata = {
  title: "Not found",
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-sm font-medium text-muted-foreground">404</p>
          <h1 className="font-semibold leading-none tracking-tight">Page not found</h1>
          <CardDescription>
            That board or page does not exist, or you do not have access to it.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild>
            <Link href="/">
              <Home />
              Back to my boards
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </main>
  );
}

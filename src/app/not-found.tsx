import Link from "next/link";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata = {
  title: "Not found",
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-sm font-medium text-muted-foreground">404</p>
          <CardTitle>Page not found</CardTitle>
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
    </div>
  );
}

import { redirect } from "next/navigation";

/** Login is off the teacher preview. `/` is the paper. */
export default function LoginPage() {
  redirect("/");
}

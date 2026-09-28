import Link from "next/link";
import type { ComponentProps } from "react";
import buttonStyles from "@/registry/components/button/button.module.css";
import styles from "./ButtonLink.module.css";

type ButtonLinkProps = ComponentProps<typeof Link> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
};

/**
 * A link that looks like Arc's Button. Arc's rule: links go places, buttons do things; its Button is
 * a <button> only, so navigation ("Back to sign in") borrows the button's own stylesheet on a Link.
 */
export function ButtonLink({ variant = "primary", size = "md", className, ...props }: ButtonLinkProps) {
  const classes = [buttonStyles.button, buttonStyles[variant], buttonStyles[size], styles.link, className].filter(Boolean).join(" ");
  return <Link {...props} className={classes} />;
}

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { clsx, twMerge };

export const IFCDC_BRAND = {
  name: "IFCDC",
  fullName: "Imperial Foundation Community Development Corporation",
  colors: {
    primary: "#1a1a2e",
    secondary: "#16213e",
    accent: "#e94560",
    gold: "#f5a623",
  },
} as const;

export type ButtonVariant = "default" | "destructive" | "outline" | "ghost" | "link";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-[#e94560] text-white hover:bg-[#d13a52]",
  destructive: "bg-red-600 text-white hover:bg-red-700",
  outline: "border border-gray-300 bg-transparent hover:bg-gray-100",
  ghost: "bg-transparent hover:bg-gray-100",
  link: "text-[#e94560] underline-offset-4 hover:underline",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4",
  lg: "h-12 px-6 text-lg",
};

export function getButtonClasses(variant: ButtonVariant = "default", size: ButtonSize = "md"): string {
  return cn(
    "inline-flex items-center justify-center rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
    variantClasses[variant],
    sizeClasses[size]
  );
}

# @ifcdc/ui-components

Shared React UI utilities and brand constants for IFCDC applications.

## Features

- `cn()` utility for Tailwind class merging
- IFCDC brand colors and constants
- Button class helpers compatible with shadcn/ui

## Usage

```tsx
import { cn, IFCDC_BRAND, getButtonClasses } from "@ifcdc/ui-components";

<button className={getButtonClasses("default", "md")}>Submit</button>
```

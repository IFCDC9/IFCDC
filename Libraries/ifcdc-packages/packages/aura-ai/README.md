# @ifcdc/aura-ai

AURA AI assistant library for IFCDC applications.

## Features

- OpenAI chat completions
- Streaming responses
- Text embeddings
- Configurable system prompts

## Usage

```typescript
import { createAuraAI } from "@ifcdc/aura-ai";

const aura = createAuraAI({ apiKey: process.env.OPENAI_API_KEY! });
const response = await aura.chat([{ role: "user", content: "Hello AURA" }]);
```

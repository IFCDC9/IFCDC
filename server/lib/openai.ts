import OpenAI from "openai";
import { resolveOpenAiCredentials, openAiClientOptions } from "./openaiConfig";

/** Shared OpenAI client — same credential resolver as AURA Executive Chat and Grant Writer. */
export function getOpenAI(): OpenAI | null {
  const creds = resolveOpenAiCredentials();
  if (!creds) return null;
  return new OpenAI(openAiClientOptions(creds));
}

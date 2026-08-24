import { http } from "@google-cloud/functions-framework";
import { createGeminiHandler } from "./handler.js";

export const generate = createGeminiHandler();
http("generate", generate);

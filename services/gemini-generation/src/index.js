import http from "node:http";
import { createGeminiHandler } from "./handler.js";

const port = Number(process.env.PORT ?? 8080);
const server = http.createServer(createGeminiHandler());

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ severity: "INFO", message: `JSOS Gemini service listening on ${port}` }));
});

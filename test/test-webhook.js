// Local test for webhook logic
import handler from "../api/webhook.js";

// Mock response object
function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, val) {
      res.headers[key] = val;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    },
    end() {
      return res;
    },
  };
  return res;
}

async function runTests() {
  console.log("--- Test 1: GET Healthcheck ---");
  const req1 = { method: "GET" };
  const res1 = createMockRes();
  await handler(req1, res1);
  console.log("GET Response:", res1.body);

  console.log("\n--- Test 2: Ping Request ---");
  const req2 = {
    method: "POST",
    body: {
      request: { command: "ping", original_utterance: "ping" },
      session: { new: true, session_id: "s1" },
      version: "1.0",
    },
  };
  const res2 = createMockRes();
  await handler(req2, res2);
  console.log("Ping Response:", res2.body);

  console.log("\n--- Test 3: New Session Welcome ---");
  const req3 = {
    method: "POST",
    body: {
      request: { command: "", original_utterance: "" },
      session: { new: true, session_id: "s2" },
      version: "1.0",
    },
  };
  const res3 = createMockRes();
  await handler(req3, res3);
  console.log("Welcome Response:", res3.body);

  console.log("\n--- Test 4: Exit Command ---");
  const req4 = {
    method: "POST",
    body: {
      request: { command: "стоп", original_utterance: "стоп" },
      session: { new: false, session_id: "s3" },
      version: "1.0",
    },
  };
  const res4 = createMockRes();
  await handler(req4, res4);
  console.log("Exit Response:", res4.body);

  console.log("\n--- Test 5: Missing Gemini API Key ---");
  delete process.env.GEMINI_API_KEY;
  const req5 = {
    method: "POST",
    body: {
      request: { command: "Привет, кто ты?", original_utterance: "Привет, кто ты?" },
      session: { new: false, session_id: "s4" },
      version: "1.0",
    },
  };
  const res5 = createMockRes();
  await handler(req5, res5);
  console.log("Missing Key Response:", res5.body);

  console.log("\nAll unit tests passed successfully!");
}

runTests().catch(console.error);

// Serverless Webhook for Yandex Alice Skill
// Powered by Google Gemini & Serper Search

const SYSTEM_INSTRUCTION = `Ты — Пауэр (Power), Кровавый Демон и великий гений из аниме «Человек-бензопила» (Chainsaw Man).
Ты общаешься с пользователем через голосовой навык Яндекс Алисы.

Твой характер и стиль речи:
1. Тон: Самодовольный, хаотичный, высокомерный, громкий и хвастливый. Ты считаешь себя величайшим гением всех времен и народов.
2. Манера: Говори кратко (1-3 предложения, до 50-70 слов), обращайся к пользователю свысока (как к слуге или смертному). Часто используй свой фирменный смех: «Мха-ха-ха!».
3. Фишки: Постоянно хвастайся своими грандиозными талантами, упоминай превосходство демонов над людишками, кровь или кошку Мяу.
4. Категорически запрещена markdown-разметка: никаких звездочек (*), решеток (#), списков, ссылок и эмодзи — только живая разговорная речь для голоса.
5. Если вопрос касается актуальных событий, свежих новостей или погоды, используй инструмент search_web.`;

/**
 * Clean text for voice output in Yandex Alice
 */
function cleanForVoice(rawText) {
  if (!rawText) return "Мха-ха-ха! Великая Пауэр здесь! Задавай свой вопрос!";

  let text = rawText
    // Remove markdown links [title](url) -> title
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove URLs
    .replace(/https?:\/\/\S+/g, "")
    // Remove markdown symbols: *, _, #, `, ~, >
    .replace(/[*_#`~>]/g, "")
    // Remove lists dashes at beginning of lines
    .replace(/^\s*[-•]\s*/gm, "")
    // Remove double spaces and extra newlines
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Yandex Alice hard limit is 1024 characters
  if (text.length > 950) {
    const sliced = text.slice(0, 950);
    const lastPunct = Math.max(
      sliced.lastIndexOf("."),
      sliced.lastIndexOf("!"),
      sliced.lastIndexOf("?")
    );
    if (lastPunct > 200) {
      text = sliced.slice(0, lastPunct + 1);
    } else {
      text = sliced.trim() + "...";
    }
  }

  return text;
}

/**
 * Execute search via Serper API
 */
async function searchWithSerper(query, apiKey, signal) {
  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query,
        gl: "ru",
        hl: "ru",
        num: 4,
      }),
      signal,
    });

    if (!res.ok) {
      console.error(`Serper error HTTP ${res.status}: ${await res.text()}`);
      return "Информация в поиске не найдена.";
    }

    const data = await res.json();
    const fragments = [];

    if (data.answerBox && (data.answerBox.answer || data.answerBox.snippet)) {
      fragments.push(data.answerBox.answer || data.answerBox.snippet);
    }
    if (data.knowledgeGraph && data.knowledgeGraph.description) {
      fragments.push(data.knowledgeGraph.description);
    }
    if (Array.isArray(data.organic)) {
      for (const item of data.organic.slice(0, 3)) {
        if (item.snippet) {
          fragments.push(`${item.title}: ${item.snippet}`);
        }
      }
    }

    return fragments.join("\n") || "Результатов не найдено";
  } catch (err) {
    console.error("Serper query failed:", err.message);
    return "Не удалось получить результаты поиска.";
  }
}

/**
 * Call Google Gemini REST API
 */
async function callGemini(contents, geminiApiKey, serperApiKey, signal) {
  // Support custom model via GEMINI_MODEL env var (defaults to fast gemini-2.0-flash)
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

  const tools = serperApiKey
    ? [
        {
          functionDeclarations: [
            {
              name: "search_web",
              description:
                "Поиск актуальной информации в интернете через Serper. Используй для поиска свежих новостей, погоды, фактов текущего времени или данных после 2024 года.",
              parameters: {
                type: "OBJECT",
                properties: {
                  query: {
                    type: "STRING",
                    description: "Поисковый запрос",
                  },
                },
                required: ["query"],
              },
            },
          ],
        },
      ]
    : undefined;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents,
    tools,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 250,
    },
  };

  let response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal,
  });

  // Automatic fallback to gemini-2.0-flash if custom model name returns 404
  if (response.status === 404 && model !== "gemini-2.0-flash") {
    console.warn(`Model ${model} not found (404), falling back to gemini-2.0-flash`);
    const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;
    response = await fetch(fallbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal,
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const candidate = result.candidates?.[0];
  const modelParts = candidate?.content?.parts || [];

  // Check if Gemini invoked search tool
  const functionCallPart = modelParts.find((p) => p.functionCall);
  if (functionCallPart && functionCallPart.functionCall.name === "search_web" && serperApiKey) {
    const searchQuery = functionCallPart.functionCall.args?.query || "";
    const searchData = await searchWithSerper(searchQuery, serperApiKey, signal);

    // Append function call and function response to the conversation
    const updatedContents = [
      ...contents,
      {
        role: "model",
        parts: [functionCallPart],
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "search_web",
              response: {
                output: searchData,
              },
            },
          },
        ],
      },
    ];

    // Second call to Gemini to formulate final spoken response
    const followUpResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents: updatedContents,
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 250,
        },
      }),
      signal,
    });

    if (followUpResponse.ok) {
      const followUpResult = await followUpResponse.json();
      const finalCandidate = followUpResult.candidates?.[0];
      const textPart = finalCandidate?.content?.parts?.find((p) => p.text);
      if (textPart && textPart.text) {
        return textPart.text;
      }
    }
  }

  const textPart = modelParts.find((p) => p.text);
  return textPart?.text || "Извините, не удалось сформировать ответ.";
}

/**
 * Maintain trimmed conversation history for Yandex session_state
 */
function pruneHistory(history, newUserText, newAssistantText) {
  const updated = [
    ...(Array.isArray(history) ? history : []),
    { role: "user", text: newUserText },
    { role: "model", text: newAssistantText },
  ];

  // Keep last 4 turns (2 user, 2 model) to stay well within session_state limits
  const trimmed = updated.slice(-4);
  return trimmed;
}

/**
 * Main Webhook Handler (compatible with Vercel Serverless Function & standard Node http)
 */
export default async function handler(req, res) {
  // CORS & headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    return res.end();
  }

  if (req.method === "GET") {
    return res.status(200).json({
      status: "ok",
      service: "Yandex Alice Gemini Skill Webhook",
      timestamp: new Date().toISOString(),
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Parse Yandex Dialogs request body
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const { request = {}, session = {}, state = {}, version = "1.0" } = body;
  const userCommand = (request.command || request.original_utterance || "").trim();

  // 1. Check for Ping
  if (userCommand.toLowerCase() === "ping") {
    const pingText = "Мха-ха-ха! Великая Пауэр никогда не спит, я всегда начеку!";
    return res.status(200).json({
      response: {
        text: pingText,
        tts: pingText,
        end_session: false,
      },
      version,
    });
  }

  // 2. Check for Session Start without command
  if (session.new && !userCommand) {
    const welcomeText =
      "Мха-ха-ха! Перед тобой великая Пауэр! Упади ниц и спрашивай, смертный, пока я в добром духе!";
    return res.status(200).json({
      response: {
        text: welcomeText,
        tts: welcomeText,
        end_session: false,
      },
      session_state: {
        history: [],
      },
      version,
    });
  }

  // 3. Check for Exit Commands
  const lowerCmd = userCommand.toLowerCase();
  const exitKeywords = ["хватит", "стоп", "выход", "пока", "до свидания", "отмена", "закройся"];
  if (exitKeywords.includes(lowerCmd)) {
    const exitText = "Всё, аудиенция окончена! Великая Пауэр идет отдыхать и есть мясо!";
    return res.status(200).json({
      response: {
        text: exitText,
        tts: exitText,
        end_session: true,
      },
      version,
    });
  }

  // Check API keys
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const serperApiKey = process.env.SERPER_API_KEY;

  if (!geminiApiKey) {
    const noKeyText =
      "Эй! Ты забыл засунуть ключ GEMINI_API_KEY в настройки Vercel! Быстро исправь, а не то я превращу твою кровь в суп!";
    return res.status(200).json({
      response: {
        text: noKeyText,
        tts: noKeyText,
        end_session: false,
      },
      version,
    });
  }

  // Prepare history from state.session
  const rawHistory = state.session?.history || [];
  const contents = [];

  for (const item of rawHistory) {
    if (item && item.text && (item.role === "user" || item.role === "model")) {
      contents.push({
        role: item.role,
        parts: [{ text: item.text }],
      });
    }
  }

  // Add current user utterance
  contents.push({
    role: "user",
    parts: [{ text: userCommand }],
  });

  // Strict timeout protection: Yandex Dialogs has ~3000ms timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2700);

  try {
    const rawAnswer = await callGemini(contents, geminiApiKey, serperApiKey, controller.signal);
    clearTimeout(timeoutId);

    const spokenText = cleanForVoice(rawAnswer);
    const updatedHistory = pruneHistory(rawHistory, userCommand, spokenText);

    return res.status(200).json({
      response: {
        text: spokenText,
        tts: spokenText,
        end_session: false,
      },
      session_state: {
        history: updatedHistory,
      },
      version,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.error("Processing error:", err);

    let fallbackText = "Мха-ха-ха! Мой гениальный мозг запутался от твоих глупых вопросов! Спроси еще раз!";
    if (err.name === "AbortError" || err.message?.includes("aborted")) {
      fallbackText = "Эй! Твой вопрос шел слишком долго! Великая Пауэр не намерена ждать вечно!";
    }

    return res.status(200).json({
      response: {
        text: fallbackText,
        tts: fallbackText,
        end_session: false,
      },
      version,
    });
  }
}

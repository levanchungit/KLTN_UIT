// Free AI Inference API helper (supports multiple free providers)
// Usage: call `sendToHf(prompt, model, apiKey)` to get generated text

export type HfResponse = {
  generated_text?: string;
  error?: string;
};

export async function sendToHf(
  prompt: string,
  model = "google/flan-t5-base",
  apiKey?: string,
  options?: { max_new_tokens?: number; temperature?: number }
): Promise<string> {
  const key = apiKey || (process && (process.env as any).HUGGINGFACE_API_KEY);

  // 1. If has Groq key (starts with gsk_), use Groq API (fastest and most reliable)
  if (key && key.startsWith("gsk_")) {
    try {
      console.log("🚀 Using Groq API...");
      const groqResponse = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant", // Fast free model
            messages: [{ role: "user", content: prompt }],
            max_tokens: options?.max_new_tokens ?? 150,
            temperature: options?.temperature ?? 0.7,
          }),
        }
      );

      if (groqResponse.ok) {
        const data = await groqResponse.json();
        const text = data?.choices?.[0]?.message?.content;
        if (text) {
          console.log("✅ Groq API success");
          return text.trim();
        }
      } else {
        const errorText = await groqResponse.text();
        console.log("❌ Groq API error:", groqResponse.status, errorText);
      }
    } catch (e) {
      console.log("❌ Groq API exception:", e);
    }
  }

  // 2. If has HF key (starts with hf_), try Hugging Face
  if (key && key.startsWith("hf_")) {
    try {
      console.log("🤗 Using Hugging Face API...");
      const body: any = {
        inputs: prompt,
        parameters: {
          max_new_tokens: options?.max_new_tokens ?? 150,
          temperature: options?.temperature ?? 0.7,
        },
      };

      const res = await fetch(
        `https://api-inference.huggingface.co/models/${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      if (res.ok) {
        const data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
          if (typeof data[0] === "object" && "generated_text" in data[0]) {
            console.log("✅ HuggingFace API success");
            return (data[0] as HfResponse).generated_text || "";
          }
          return String(data[0]);
        }

        if (data && typeof data === "object" && "generated_text" in data) {
          return (data as HfResponse).generated_text || "";
        }
      } else {
        const errorText = await res.text();
        console.log("❌ HuggingFace API error:", res.status, errorText);
      }
    } catch (e) {
      console.log("❌ HuggingFace API exception:", e);
    }
  }

  // 3. Final fallback: simple template-based response (completely offline)
  console.log("⚠️ All AI APIs failed, using simple fallback");

  // Extract key info for simple response
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes("extract") || lowerPrompt.includes("amount")) {
    // For amount extraction, return empty to let regex handle it
    return "";
  }

  // For general prompts, return acknowledgment
  return `Đã ghi nhận giao dịch.`;
}

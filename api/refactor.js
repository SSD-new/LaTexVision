
import { GoogleGenAI } from "@google/genai";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { text, prompt } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const strictPrompt = `You are a LaTeX expert.
Rules:
- Preserve content and order exactly.
- Do NOT add new content (unless asked).
- Do NOT remove information.
- Fix broken line breaks.
- Output ONLY LaTeX.
`;
    
    const userInstruction = prompt ? `User Instructions:\n${prompt}` : "";

    const fullPrompt = `${strictPrompt}\n\n${userInstruction}\n\nContent to process:\n${text}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: {
        parts: [{ text: fullPrompt }]
      },
      config: {
        temperature: 0.1,
      }
    });

    let cleaned = response.text || "";
    // Basic cleanup
    cleaned = cleaned.replace(/```(?:latex)?/gi, "").replace(/```/g, "").trim();
    cleaned = cleaned.replace(/\\documentclass[\s\S]*?\\begin\{document\}/g, "");
    cleaned = cleaned.replace(/\\end\{document\}/g, "");
    
    return res.status(200).json({ text: cleaned });

  } catch (error) {
    console.error("Gemini Refactor Error:", error);
    return res.status(500).json({ error: error.message });
  }
}

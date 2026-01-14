
import { GoogleGenAI } from "@google/genai";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: {
        parts: [
          {
            text: `You are given LaTeX text produced by OCR.

Task:
- Do NOT add new content
- Do NOT remove information
- Do NOT solve or explain

ONLY:
- Remove duplicated paragraphs
- Fix broken line breaks
- Normalize formatting

Output LaTeX only.

${text}`
          }
        ]
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

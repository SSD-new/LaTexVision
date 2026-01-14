
import { GoogleGenAI } from "@google/genai";

export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '4mb',
    },
  },
};

function cleanLatex(text) {
  let processed = text;
  // Remove markdown code blocks
  processed = processed.replace(/```(?:latex)?/gi, "").replace(/```/g, "");
  // Remove document wrappers
  processed = processed.replace(/\\documentclass[\s\S]*?\\begin\{document\}/g, "");
  processed = processed.replace(/\\end\{document\}/g, "");
  processed = processed.replace(/\\usepackage\{.*?\}/g, "");
  return processed.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { base64Data, mimeType } = req.body;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash', 
      contents: {
        parts: [
          { 
            text: `Transcribe the image into LaTeX.
Elements:
- plain text
- inline formulas ($...$)
- standalone formulas (\\[...\\])

Rules:
- Preserve content and order exactly
- Do NOT invent or solve anything
- Output LaTeX only
- No document headers or packages` 
          },
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType || 'image/png'
            }
          }
        ]
      },
      config: {
        temperature: 0.1,
      }
    });

    const text = cleanLatex(response.text || "");
    return res.status(200).json({ text });

  } catch (error) {
    console.error("Gemini API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}

import { GoogleGenAI, Type } from "@google/genai";
import { PRInfo, FileDiff, PRAnalysis } from "../types.ts";

export async function analyzeBatch(
  prInfo: PRInfo,
  changes: FileDiff[],
  batchIndex: number,
  totalBatches: number,
  customInstructions: string,
  systemContext: string
): Promise<PRAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const changesContext = changes
    .map(
      (f) => `
--- FILE: ${f.path} ---
Action: ${f.changeType}
Content:
${f.content || "[No Content or Binary File]"}
------------------------
`
    )
    .join("\n\n");

  const prompt = `
# SYSTEM MISSION: PRINCIPAL ENGINEER AUDIT & KPI GENERATION
Analyze the following code changes. Provide a deep review and high-level management KPIs.

## EXTERNAL SYSTEM CONTEXT
${systemContext || "No specific external context provided."}

## CUSTOM PROJECT CONSTRAINTS
${customInstructions || "Follow general industry best practices."}

## PR CONTEXT
Title: ${prInfo.title}
Description: ${prInfo.description}

## BATCH SOURCE CODE
${changesContext}

## TASK
1. General code review (bugs, security, logic).
2. Generate 'stats' for a technical manager:
   - complexityScore: 1-10 (How difficult is this to maintain?)
   - riskLevel: Low/Medium/High/Critical
   - estimatedReviewMinutes: Estimated time for a human to deeply review this batch.
   - blastRadius: Isolated (single file/function), Module-wide, or System-wide (core infra).
   - testPresence: Are there new/updated tests in this batch? (Missing/Partial/Comprehensive)
   - breakingChange: Does this look like it breaks existing APIs? (boolean)

Return strictly JSON.
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            overallHealth: {
              type: Type.STRING,
              enum: ["Excellent", "Good", "Needs Improvement", "Critical"],
            },
            architecturalImpact: { type: Type.STRING },
            contextAlignment: { type: Type.STRING },
            keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
            securityConcerns: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            performanceTips: { type: Type.ARRAY, items: { type: Type.STRING } },
            stats: {
              type: Type.OBJECT,
              properties: {
                complexityScore: { type: Type.NUMBER },
                riskLevel: {
                  type: Type.STRING,
                  enum: ["Low", "Medium", "High", "Critical"],
                },
                estimatedReviewMinutes: { type: Type.NUMBER },
                blastRadius: {
                  type: Type.STRING,
                  enum: ["Isolated", "Module-wide", "System-wide"],
                },
                testPresence: {
                  type: Type.STRING,
                  enum: ["Missing", "Partial", "Comprehensive"],
                },
                breakingChange: { type: Type.BOOLEAN },
              },
              required: [
                "complexityScore",
                "riskLevel",
                "estimatedReviewMinutes",
                "blastRadius",
                "testPresence",
                "breakingChange",
              ],
            },
            codeReviewComments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  file: { type: Type.STRING },
                  line: { type: Type.NUMBER },
                  comment: { type: Type.STRING },
                  suggestedChange: { type: Type.STRING },
                  severity: {
                    type: Type.STRING,
                    enum: ["high", "medium", "low"],
                  },
                  type: {
                    type: Type.STRING,
                    enum: [
                      "logic",
                      "security",
                      "style",
                      "performance",
                      "contract",
                    ],
                  },
                },
                required: ["file", "comment", "severity", "type"],
              },
            },
          },
          required: [
            "summary",
            "overallHealth",
            "architecturalImpact",
            "contextAlignment",
            "keyPoints",
            "codeReviewComments",
            "securityConcerns",
            "performanceTips",
            "stats",
          ],
        },
        thinkingConfig: { thinkingBudget: 15000 },
      },
    });

    const text = response.text;
    if (!text) throw new Error("Empty response from AI");
    return JSON.parse(text);
  } catch (error: any) {
    console.error("Gemini analysis error:", error);
    throw new Error(`AI Analysis failed: ${error.message || "Unknown error"}`);
  }
}

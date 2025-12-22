import OpenAI from "openai";
import { PRInfo, FileDiff, PRAnalysis } from "../types.ts";

export async function analyzeBatch(
  prInfo: PRInfo,
  changes: FileDiff[],
  batchIndex: number,
  totalBatches: number,
  customInstructions: string,
  systemContext: string
): Promise<PRAnalysis> {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) {
    throw new Error("GLM API Key is missing.");
  }

  const jsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },

      overallHealth: {
        type: "string",
        enum: ["Excellent", "Good", "Needs Improvement", "Critical"],
      },

      architecturalImpact: { type: "string" },
      contextAlignment: { type: "string" },

      keyPoints: { type: "array", items: { type: "string" } },

      securityConcerns: { type: "array", items: { type: "string" } },
      performanceTips: { type: "array", items: { type: "string" } },

      stats: {
        type: "object",
        additionalProperties: false,
        properties: {
          complexityScore: { type: "number", minimum: 1, maximum: 10 },
          riskLevel: {
            type: "string",
            enum: ["Low", "Medium", "High", "Critical"],
          },
          estimatedReviewMinutes: { type: "number", minimum: 0 },
          blastRadius: {
            type: "string",
            enum: ["Isolated", "Module-wide", "System-wide"],
          },
          testPresence: {
            type: "string",
            enum: ["Missing", "Partial", "Comprehensive"],
          },
          breakingChange: { type: "boolean" },
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
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            file: { type: "string" },
            line: { type: "number", minimum: 1 },
            comment: { type: "string" },
            suggestedChange: { type: "string" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            type: {
              type: "string",
              enum: ["logic", "security", "style", "performance", "contract"],
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
  };

  const client = new OpenAI({
    apiKey: apiKey,
    baseURL: "https://api.z.ai/api/coding/paas/v4",
    dangerouslyAllowBrowser: true,
  });

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

##STRICT JSON RESPONSE

Output rules (non-negotiable):
- Output MUST be a single JSON object and NOTHING else.
- Do NOT wrap in markdown fences. Do NOT add explanations.
- Include ALL required keys exactly as defined by the JSON Schema.
- Do NOT output any keys not present in the schema.
- If you cannot infer a value, use:
  - "" for strings
  - [] for arrays
  - 0 for numbers (except complexityScore must be 1-10; use 5 if unknown)
  - false for booleans
- riskLevel, overallHealth, blastRadius, testPresence MUST be one of the enum values.

Return JSON that validates against this JSON Schema:
'{"type":"object","additionalProperties":false,"properties":{"summary":{"type":"string"},"overallHealth":{"type":"string","enum":["Excellent","Good","Needs Improvement","Critical"]},"architecturalImpact":{"type":"string"},"contextAlignment":{"type":"string"},"keyPoints":{"type":"array","items":{"type":"string"}},"securityConcerns":{"type":"array","items":{"type":"string"}},"performanceTips":{"type":"array","items":{"type":"string"}},"stats":{"type":"object","additionalProperties":false,"properties":{"complexityScore":{"type":"number","minimum":1,"maximum":10},"riskLevel":{"type":"string","enum":["Low","Medium","High","Critical"]},"estimatedReviewMinutes":{"type":"number","minimum":0},"blastRadius":{"type":"string","enum":["Isolated","Module-wide","System-wide"]},"testPresence":{"type":"string","enum":["Missing","Partial","Comprehensive"]},"breakingChange":{"type":"boolean"}},"required":["complexityScore","riskLevel","estimatedReviewMinutes","blastRadius","testPresence","breakingChange"]},"codeReviewComments":{"type":"array","items":{"type":"object","additionalProperties":false,"properties":{"file":{"type":"string"},"line":{"type":"number","minimum":1},"comment":{"type":"string"},"suggestedChange":{"type":"string"},"severity":{"type":"string","enum":["high","medium","low"]},"type":{"type":"string","enum":["logic","security","style","performance","contract"]}},"required":["file","comment","severity","type"]}}},"required":["summary","overallHealth","architecturalImpact","contextAlignment","keyPoints","codeReviewComments","securityConcerns","performanceTips","stats"]}'


Return strictly JSON schema striclty with this schema ${jsonSchema}.
`;

  try {
    const response = await client.chat.completions.create({
      model: "GLM-4.6",
      messages: [
        {
          role: "system",
          content:
            "You are an expert software engineer performing code reviews and generating management KPIs. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "pr_analysis",
          schema: jsonSchema,
          strict: true,
        },
      },
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    debugger;
    if (!content) throw new Error("Empty response from GLM");

    // Parse the GLM response and transform it to match expected format
    let parsed;
    try {
      // First, try to parse the content directly
      parsed = JSON.parse(content);
    } catch (firstParseError) {
      // If that fails, the content might be a stringified JSON within the actual JSON
      try {
        // Extract the JSON string from the content (removing any extra whitespace/newlines)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("Could not extract valid JSON from response");
        }
      } catch (secondParseError) {
        console.error("GLM parse error:", {
          firstParseError,
          secondParseError,
          content,
        });
        throw new Error("Failed to parse GLM response as JSON");
      }
    }

    // If response is already in expected format, return as-is
    if (parsed.summary && parsed.stats) {
      return parsed;
    }

    const normalizeRiskLevel = (
      value: unknown
    ): PRAnalysis["stats"]["riskLevel"] => {
      if (typeof value !== "string") return "Medium";
      const normalized = value.toLowerCase();
      if (normalized === "low") return "Low";
      if (normalized === "medium") return "Medium";
      if (normalized === "high") return "High";
      if (normalized === "critical") return "Critical";
      return "Medium";
    };

    const normalizeString = (value: unknown): string => {
      if (typeof value === "string") return value;
      if (value === null || value === undefined) return "";
      if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
      }
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };

    const normalizeStringArray = (value: unknown): string[] => {
      if (!value) return [];
      const list = Array.isArray(value) ? value : [value];
      return list
        .map((entry) => normalizeString(entry).trim())
        .filter((entry) => entry.length > 0);
    };

    // Handle GLM's nested response structure and alternate KPI key names
    const glmResponse = parsed.answer ?? parsed;
    const kpis =
      glmResponse?.managementKPIs ?? glmResponse?.kpis ?? glmResponse?.stats;
    if (kpis) {
      const codeReview = glmResponse?.codeReview || {};
      const issues = normalizeStringArray(codeReview.issues);
      const recommendations = normalizeStringArray(codeReview.recommendations);
      const riskLevel = normalizeRiskLevel(kpis.riskLevel);

      // Transform GLM response to match expected PRAnalysis format
      const transformed: PRAnalysis = {
        summary:
          codeReview.summary ||
          glmResponse.summary ||
          "Code review completed with GLM analysis",
        overallHealth:
          riskLevel === "High"
            ? "Needs Improvement"
            : riskLevel === "Critical"
            ? "Critical"
            : riskLevel === "Low"
            ? "Excellent"
            : "Good",
        architecturalImpact:
          codeReview.summary ||
          glmResponse.architecturalImpact ||
          "Architectural changes detected",
        contextAlignment:
          glmResponse.contextAlignment ||
          "Changes align with system requirements",
        keyPoints: [...issues, ...recommendations],
        securityConcerns: issues.filter(
          (issue: string) =>
            issue.toLowerCase().includes("security") ||
            issue.toLowerCase().includes("auth")
        ),
        performanceTips: recommendations.filter(
          (rec: string) =>
            rec.toLowerCase().includes("performance") ||
            rec.toLowerCase().includes("optimization")
        ),
        stats: {
          complexityScore: kpis.complexityScore ?? 5,
          riskLevel,
          estimatedReviewMinutes: kpis.estimatedReviewMinutes ?? 30,
          blastRadius: (kpis.blastRadius ??
            "Module-wide") as PRAnalysis["stats"]["blastRadius"],
          testPresence: (kpis.testPresence ??
            "Partial") as PRAnalysis["stats"]["testPresence"],
          breakingChange: Boolean(kpis.breakingChange),
        },
        codeReviewComments: [
          // Transform code review issues to code review comments
          ...issues.map((issue: string, index: number) => ({
            file: "review",
            line: index + 1,
            comment: issue,
            severity:
              riskLevel === "High" || riskLevel === "Critical"
                ? "high"
                : riskLevel === "Medium"
                ? "medium"
                : ("low" as "high" | "medium" | "low"),
            type: issue.toLowerCase().includes("security")
              ? ("security" as
                  | "logic"
                  | "security"
                  | "style"
                  | "performance"
                  | "contract")
              : ("logic" as
                  | "logic"
                  | "security"
                  | "style"
                  | "performance"
                  | "contract"),
          })),
        ],
      };

      return transformed;
    }

    // Fallback: create a minimal valid PRAnalysis if parsing fails
    console.warn("GLM response structure unexpected, using fallback:", parsed);
    return {
      summary: "Analysis completed with limited data",
      overallHealth: "Good",
      architecturalImpact: "Changes detected",
      contextAlignment: "Standard alignment",
      keyPoints: ["Analysis completed"],
      securityConcerns: [],
      performanceTips: [],
      stats: {
        complexityScore: 5,
        riskLevel: "Medium",
        estimatedReviewMinutes: 30,
        blastRadius: "Module-wide",
        testPresence: "Missing",
        breakingChange: false,
      },
      codeReviewComments: [],
    };
  } catch (error: any) {
    console.error("GLM analysis error:", error);

    // Return a fallback PRAnalysis instead of throwing to prevent UI crashes
    return {
      summary: "Analysis failed - please try again",
      overallHealth: "Critical",
      architecturalImpact: "Unable to analyze",
      contextAlignment: "Analysis incomplete",
      keyPoints: ["Analysis failed"],
      securityConcerns: ["Unable to complete security analysis"],
      performanceTips: ["Unable to analyze performance"],
      stats: {
        complexityScore: 1,
        riskLevel: "Critical",
        estimatedReviewMinutes: 0,
        blastRadius: "Isolated",
        testPresence: "Missing",
        breakingChange: false,
      },
      codeReviewComments: [
        {
          file: "analysis",
          line: 1,
          comment: `Analysis failed: ${error.message || "Unknown error"}`,
          severity: "high",
          type: "logic",
        },
      ],
    };
  }
}

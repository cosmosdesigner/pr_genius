export interface AzureDevOpsParams {
  organization: string;
  project: string;
  repository: string;
  pullRequestId: string;
}

export interface PRInfo {
  title: string;
  description: string;
  createdBy: string;
  sourceBranch: string;
  targetBranch: string;
  status: string;
}

export interface FileDiff {
  path: string;
  changeType: string;
  content?: string;
  originalPath?: string;
}

export interface BossStats {
  complexityScore: number; // 1-10
  riskLevel: "Low" | "Medium" | "High" | "Critical";
  estimatedReviewMinutes: number;
  blastRadius: "Isolated" | "Module-wide" | "System-wide";
  testPresence: "Missing" | "Partial" | "Comprehensive";
  breakingChange: boolean;
}

export interface PRAnalysis {
  summary: string;
  overallHealth: "Excellent" | "Good" | "Needs Improvement" | "Critical";
  architecturalImpact: string;
  contextAlignment?: string;
  keyPoints: string[];
  securityConcerns: string[];
  performanceTips: string[];
  stats: BossStats; // Added boss stats
  codeReviewComments: Array<{
    file: string;
    line?: number;
    comment: string;
    suggestedChange?: string;
    severity: "low" | "medium" | "high";
    type: "logic" | "security" | "style" | "performance" | "contract";
  }>;
}

export type AIProvider = "gemini" | "glm";

export interface AppState {
  isAnalyzing: boolean;
  error: string | null;
  prInfo: PRInfo | null;
  analysis: PRAnalysis | null;
  allChanges: any[];
  processedCount: number;
  commitId: string | null;
  params: AzureDevOpsParams | null;
  systemInstructions: string;
  systemContext: string;
  aiProvider: AIProvider;
}

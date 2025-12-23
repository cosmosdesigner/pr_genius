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

// PR Creation types
export interface PRCreateParams {
  organization: string;
  project: string;
  repository: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  requiredReviewers?: string[];
  optionalReviewers?: string[];
  workItems?: number[];
  autoComplete?: boolean;
  deleteSourceBranch?: boolean;
  mergeStrategy?: "squash" | "merge" | "rebase";
}

export interface PRCreateResult {
  pullRequestId: number;
  url: string;
  title: string;
  status: string;
  createdBy: {
    displayName: string;
  };
  creationDate: string;
  sourceRefName: string;
  targetRefName: string;
  reviewers?: PRReviewer[];
}

export interface PRReviewer {
  reviewer: {
    displayName: string;
    uniqueName: string;
  };
  vote: number;
  isRequired: boolean;
}

export interface PRCreateState {
  isCreating: boolean;
  error: string | null;
  result: PRCreateResult | null;
}

// PR Review types
export interface PRReviewParams {
  organization: string;
  project: string;
  repository: string;
  pullRequestId: number;
}

export interface PRReviewComment {
  id: number;
  author: {
    displayName: string;
    uniqueName: string;
  };
  content: string;
  threadContext?: {
    filePath: string;
    lineNumber?: number;
  };
  publishedDate: string;
  lastUpdatedDate: string;
  isDeleted: boolean;
}

export interface PRReviewThread {
  id: number;
  status: "active" | "fixed" | "wontFix" | "closed" | "byDesign";
  comments: PRReviewComment[];
  threadContext?: {
    filePath: string;
    leftFileEnd?: {
      line: number;
      offset: number;
    };
    leftFileStart?: {
      line: number;
      offset: number;
    };
    rightFileEnd?: {
      line: number;
      offset: number;
    };
    rightFileStart?: {
      line: number;
      offset: number;
    };
  };
  publishedDate: string;
  lastUpdatedDate: string;
}

export interface PRReviewDetails {
  pullRequestId: number;
  title: string;
  description: string;
  createdBy: {
    displayName: string;
    uniqueName: string;
  };
  creationDate: string;
  sourceRefName: string;
  targetRefName: string;
  status: string;
  mergeStatus: string;
  reviewers: PRReviewer[];
  threads: PRReviewThread[];
  url: string;
  repository: {
    name: string;
    url: string;
  };
  project: {
    name: string;
    url: string;
  };
}

export interface PRReviewVote {
  reviewerId: string;
  vote: number; // 0: No vote, 5: Approved, 10: Approved with suggestions, -5: Waiting for author, -10: Rejected
  isRequired: boolean;
}

export interface PRReviewState {
  isLoading: boolean;
  error: string | null;
  reviewDetails: PRReviewDetails | null;
  isSubmittingVote: boolean;
  isSubmittingComment: boolean;
}

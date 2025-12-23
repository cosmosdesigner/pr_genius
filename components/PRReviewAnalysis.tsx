import React, { useState, useEffect, useMemo } from "react";
import { PRReviewParams, PRReviewDetails } from "../types.ts";
import {
  getPRFileDiffs,
  getPRReviewDetails,
  submitPRVote,
  createPRComment,
  replyToPRComment,
  updateThreadStatus,
  getVoteStatus,
  getThreadStatus,
} from "../services/prReviewService.ts";
import { analyzeBatch as geminiAnalyzeBatch } from "../services/geminiService.ts";
import { analyzeBatch as glmAnalyzeBatch } from "../services/glmService.ts";
import { AIProvider } from "../types.ts";
import prettier from "prettier/standalone";
import prettierBabel from "prettier/plugins/babel";
import prettierTypeScript from "prettier/plugins/typescript";
import prettierPostcss from "prettier/plugins/postcss";
import prettierHtml from "prettier/plugins/html";
import prettierMarkdown from "prettier/plugins/markdown";
import prettierYaml from "prettier/plugins/yaml";
import prettierGraphql from "prettier/plugins/graphql";
import prettierEstree from "prettier/plugins/estree";

interface PRReviewAnalysisProps {
  pat: string;
  aiProvider: AIProvider;
  systemInstructions: string;
  systemContext: string;
  onReviewSuccess: (details: PRReviewDetails) => void;
}

interface FileDiff {
  path: string;
  changeType: string;
  sourceContent?: string;
  targetContent?: string;
}

type DiffLineType = "same" | "added" | "removed" | "empty";

interface DiffLine {
  text: string;
  lineNumber: number | null;
  type: DiffLineType;
}

const PRETTIER_PLUGINS = [
  prettierBabel,
  prettierTypeScript,
  prettierPostcss,
  prettierHtml,
  prettierMarkdown,
  prettierYaml,
  prettierGraphql,
  prettierEstree,
];

function normalizeContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function getPrettierParser(filePath: string): string | null {
  const match = filePath.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  switch (match[1]) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "babel";
    case "json":
    case "jsonc":
      return "json";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "less":
      return "less";
    case "html":
    case "htm":
      return "html";
    case "md":
    case "markdown":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "graphql":
    case "gql":
      return "graphql";
    default:
      return null;
  }
}

async function formatWithPrettier(
  content: unknown,
  filePath: string
): Promise<string> {
  const safeContent = normalizeContent(content);
  if (!safeContent) return "";
  if (safeContent.includes("[Binary File")) return safeContent;
  if (safeContent.includes("[TRUNCATED")) return safeContent;
  const parser = getPrettierParser(filePath);
  if (!parser) return safeContent;
  try {
    return await prettier.format(safeContent, {
      parser,
      plugins: PRETTIER_PLUGINS as any[],
    });
  } catch (error) {
    console.warn("Prettier formatting failed:", error);
    return safeContent;
  }
}

function buildSideBySideDiff(
  source: string,
  target: string
): { left: DiffLine[]; right: DiffLine[] } {
  const sourceText = normalizeContent(source);
  const targetText = normalizeContent(target);
  const sourceLines = sourceText.split(/\r?\n/);
  const targetLines = targetText.split(/\r?\n/);
  const sourceLength = sourceLines.length;
  const targetLength = targetLines.length;

  const lcsTable: number[][] = Array.from(
    { length: sourceLength + 1 },
    () => Array(targetLength + 1).fill(0)
  );

  for (let i = 1; i <= sourceLength; i += 1) {
    for (let j = 1; j <= targetLength; j += 1) {
      if (sourceLines[i - 1] === targetLines[j - 1]) {
        lcsTable[i][j] = lcsTable[i - 1][j - 1] + 1;
      } else {
        lcsTable[i][j] = Math.max(lcsTable[i - 1][j], lcsTable[i][j - 1]);
      }
    }
  }

  const left: DiffLine[] = [];
  const right: DiffLine[] = [];

  let i = sourceLength;
  let j = targetLength;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && sourceLines[i - 1] === targetLines[j - 1]) {
      left.push({
        text: sourceLines[i - 1],
        lineNumber: i,
        type: "same",
      });
      right.push({
        text: targetLines[j - 1],
        lineNumber: j,
        type: "same",
      });
      i -= 1;
      j -= 1;
    } else if (
      j > 0 &&
      (i === 0 || lcsTable[i][j - 1] >= lcsTable[i - 1][j])
    ) {
      left.push({
        text: "",
        lineNumber: null,
        type: "empty",
      });
      right.push({
        text: targetLines[j - 1],
        lineNumber: j,
        type: "added",
      });
      j -= 1;
    } else {
      left.push({
        text: sourceLines[i - 1],
        lineNumber: i,
        type: "removed",
      });
      right.push({
        text: "",
        lineNumber: null,
        type: "empty",
      });
      i -= 1;
    }
  }

  left.reverse();
  right.reverse();

  return { left, right };
}

function buildUnifiedDiffText(
  baseText: string,
  updatedText: string,
  filePath: string
): string {
  const diff = buildSideBySideDiff(baseText, updatedText);
  const lines: string[] = [];

  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);

  for (let index = 0; index < diff.left.length; index += 1) {
    const leftLine = diff.left[index];
    const rightLine = diff.right[index];

    if (rightLine.type === "added") {
      lines.push(`+${rightLine.text}`);
      continue;
    }

    if (leftLine.type === "removed") {
      lines.push(`-${leftLine.text}`);
      continue;
    }

    lines.push(` ${leftLine.text}`);
  }

  return lines.join("\n");
}

const PRReviewAnalysis: React.FC<PRReviewAnalysisProps> = ({
  pat,
  aiProvider,
  systemInstructions,
  systemContext,
  onReviewSuccess,
}) => {
  const [prUrl, setPrUrl] = useState("");
  const [organization, setOrganization] = useState("");
  const [project, setProject] = useState("");
  const [repository, setRepository] = useState("");
  const [pullRequestId, setPullRequestId] = useState("");

  const [reviewDetails, setReviewDetails] = useState<PRReviewDetails | null>(
    null
  );
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileDiff | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
  const [formattedSource, setFormattedSource] = useState("");
  const [formattedTarget, setFormattedTarget] = useState("");
  const [isFormatting, setIsFormatting] = useState(false);
  const [replyContent, setReplyContent] = useState<{
    [threadId: number]: string;
  }>({});

  const [isSubmittingVote, setIsSubmittingVote] = useState(false);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  // Parse PR URL when provided
  useEffect(() => {
    if (prUrl) {
      const params = parsePRUrl(prUrl);
      if (params) {
        setOrganization(params.organization);
        setProject(params.project);
        setRepository(params.repository);
        setPullRequestId(params.pullRequestId);
      }
    }
  }, [prUrl]);

  // Load review details and file diffs when PR is loaded
  useEffect(() => {
    if (organization && project && repository && pullRequestId && pat) {
      loadPRDetails();
    }
  }, [organization, project, repository, pullRequestId, pat]);

  function parsePRUrl(url: string) {
    try {
      console.log("Parsing PR URL:", url);
      const prUrl = new URL(url);
      const pathParts = prUrl.pathname.split("/").filter((p) => p !== "");
      const pathPartsLower = pathParts.map((part) => part.toLowerCase());
      const decodePart = (value: string) => decodeURIComponent(value);
      console.log("URL hostname:", prUrl.hostname);
      console.log("URL path parts:", pathParts);

      // Support for dev.azure.com
      if (
        pathParts.length >= 6 &&
        pathPartsLower[2] === "_git" &&
        (pathPartsLower[4] === "pullrequest" ||
          pathPartsLower[4] === "pullrequests")
      ) {
        const result = {
          organization: decodePart(pathParts[0]),
          project: decodePart(pathParts[1]),
          repository: decodePart(pathParts[3]),
          pullRequestId: decodePart(pathParts[5]),
        };
        console.log("Parsed dev.azure.com URL result:", result);

        // Test the constructed URL
        const testUrl = `https://dev.azure.com/${result.organization}/${result.project}/_apis/git/repositories/${result.repository}/pullRequests/${result.pullRequestId}?api-version=7.0`;
        console.log("Test URL that would be constructed:", testUrl);

        return result;
      }

      // Support for dev.azure.com API URLs
      if (
        pathParts.length >= 8 &&
        pathPartsLower[2] === "_apis" &&
        pathPartsLower[3] === "git" &&
        pathPartsLower[4] === "repositories" &&
        (pathPartsLower[6] === "pullrequests" ||
          pathPartsLower[6] === "pullrequest")
      ) {
        const result = {
          organization: decodePart(pathParts[0]),
          project: decodePart(pathParts[1]),
          repository: decodePart(pathParts[5]),
          pullRequestId: decodePart(pathParts[7]),
        };
        console.log("Parsed dev.azure.com API URL result:", result);

        const testUrl = `https://dev.azure.com/${result.organization}/${result.project}/_apis/git/repositories/${result.repository}/pullRequests/${result.pullRequestId}?api-version=7.0`;
        console.log("Test URL that would be constructed:", testUrl);

        return result;
      }

      // Support for organization.visualstudio.com
      const hostParts = prUrl.hostname.split(".");
      if (
        hostParts[1] === "visualstudio" &&
        pathPartsLower[1] === "_git"
      ) {
        const result = {
          organization: decodePart(hostParts[0]),
          project: decodePart(pathParts[0]),
          repository: decodePart(pathParts[2]),
          pullRequestId: decodePart(pathParts[4]),
        };
        console.log("Parsed visualstudio.com URL result:", result);
        return result;
      }
      console.log("URL format not recognized");
      return null;
    } catch (error) {
      console.error("Error parsing PR URL:", error);
      return null;
    }
  }

  const loadPRDetails = async () => {
    try {
      const prId = parseInt(pullRequestId);
      if (isNaN(prId)) {
        console.error("Invalid PR ID:", pullRequestId);
        return;
      }

      // Validate required fields
      if (!organization || !project || !repository || !pat) {
        console.error("Missing required fields:", {
          organization,
          project,
          repository,
          hasPat: !!pat,
        });
        return;
      }

      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: prId,
      };

      console.log("Loading PR details with params:", params);

      const [details, diffs] = await Promise.all([
        getPRReviewDetails(params, pat),
        getPRFileDiffs(params, pat),
      ]);

      setReviewDetails(details);
      setFileDiffs(diffs);
    } catch (error: any) {
      console.error("Failed to load PR details:", error);
      // Show user-friendly error message
      alert(
        `Failed to load PR details: ${error.message}. Please check your PAT and PR URL.`
      );
    }
  };

  const analyzeFileChanges = async () => {
    if (
      !selectedFile ||
      !selectedFile.sourceContent ||
      !selectedFile.targetContent
    )
      return;

    setIsAnalyzing(true);
    try {
      const analyzeFunction =
        aiProvider === "glm" ? glmAnalyzeBatch : geminiAnalyzeBatch;

      const mockPRInfo = {
        title: reviewDetails?.title || "",
        description: reviewDetails?.description || "",
        createdBy: reviewDetails?.createdBy?.displayName || "",
        sourceBranch:
          reviewDetails?.sourceRefName?.replace("refs/heads/", "") || "",
        targetBranch:
          reviewDetails?.targetRefName?.replace("refs/heads/", "") || "",
        status: reviewDetails?.status || "",
      };

      const sourceText =
        formattedSource !== ""
          ? formattedSource
          : normalizeContent(selectedFile.sourceContent);
      const targetText =
        formattedTarget !== ""
          ? formattedTarget
          : normalizeContent(selectedFile.targetContent);
      const unifiedDiff = buildUnifiedDiffText(
        targetText,
        sourceText,
        selectedFile.path
      );

      const fileDiffsForAnalysis = [
        {
          path: selectedFile.path,
          changeType: selectedFile.changeType,
          content: `Diff (target -> source):\n${unifiedDiff}`,
          originalPath: selectedFile.path,
        },
      ];

      const result = await analyzeFunction(
        mockPRInfo,
        fileDiffsForAnalysis,
        0,
        1,
        systemInstructions,
        systemContext
      );

      setAnalysis(result);
    } catch (error: any) {
      console.error("Analysis failed:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUpdateThreadStatus = async (
    threadId: number,
    status: "active" | "fixed" | "wontFix" | "closed" | "byDesign"
  ) => {
    if (!reviewDetails) return;

    try {
      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: reviewDetails.pullRequestId,
      };

      await updateThreadStatus(params, pat, threadId, status);

      // Refresh review details
      const updatedDetails = await getPRReviewDetails(params, pat);
      setReviewDetails(updatedDetails);
      onReviewSuccess(updatedDetails);
    } catch (error: any) {
      console.error("Failed to update thread status:", error);
    }
  };

  const handleVote = async (vote: number) => {
    if (!reviewDetails) return;

    setIsSubmittingVote(true);
    try {
      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: reviewDetails.pullRequestId,
      };

      await submitPRVote(params, pat, vote);

      // Refresh review details
      const updatedDetails = await getPRReviewDetails(params, pat);
      setReviewDetails(updatedDetails);
      onReviewSuccess(updatedDetails);
    } catch (error: any) {
      console.error("Failed to submit vote:", error);
    } finally {
      setIsSubmittingVote(false);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !reviewDetails) return;

    setIsSubmittingComment(true);
    try {
      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: reviewDetails.pullRequestId,
      };

      const threadContext = selectedFile
        ? {
            filePath: selectedFile.path,
            lineNumber: undefined, // Could be enhanced to support line numbers
          }
        : undefined;

      await createPRComment(params, pat, newComment, threadContext);

      // Refresh review details
      const updatedDetails = await getPRReviewDetails(params, pat);
      setReviewDetails(updatedDetails);
      onReviewSuccess(updatedDetails);

      setNewComment("");
    } catch (error: any) {
      console.error("Failed to add comment:", error);
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleReply = async (threadId: number) => {
    const reply = replyContent[threadId];
    if (!reply?.trim() || !reviewDetails) return;

    try {
      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: reviewDetails.pullRequestId,
      };

      await replyToPRComment(params, pat, threadId, reply);

      // Refresh review details
      const updatedDetails = await getPRReviewDetails(params, pat);
      setReviewDetails(updatedDetails);
      onReviewSuccess(updatedDetails);

      setReplyContent((prev) => ({ ...prev, [threadId]: "" }));
    } catch (error: any) {
      console.error("Failed to reply:", error);
    }
  };

  useEffect(() => {
    let cancelled = false;

    if (!selectedFile) {
      setFormattedSource("");
      setFormattedTarget("");
      setIsFormatting(false);
      return () => {
        cancelled = true;
      };
    }

    setIsFormatting(true);

    const sourceText = normalizeContent(selectedFile.sourceContent);
    const targetText = normalizeContent(selectedFile.targetContent);

    const runFormatting = async () => {
      const [formattedSourceText, formattedTargetText] = await Promise.all([
        formatWithPrettier(sourceText, selectedFile.path),
        formatWithPrettier(targetText, selectedFile.path),
      ]);

      if (cancelled) return;

      setFormattedSource(formattedSourceText);
      setFormattedTarget(formattedTargetText);
      setIsFormatting(false);
    };

    runFormatting();

    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  const diffLines = useMemo(() => {
    if (!selectedFile) {
      return { left: [], right: [] };
    }

    const sourceText =
      formattedSource !== ""
        ? formattedSource
        : normalizeContent(selectedFile.sourceContent);
    const targetText =
      formattedTarget !== ""
        ? formattedTarget
        : normalizeContent(selectedFile.targetContent);

    return buildSideBySideDiff(sourceText, targetText);
  }, [formattedSource, formattedTarget, selectedFile]);

  const renderDiffLines = (lines: DiffLine[], side: "left" | "right") => {
    return lines.map((line, index) => {
      const highlightClass =
        side === "left"
          ? "bg-green-500/10 text-green-200 border-l-2 border-green-500/40"
          : "bg-red-500/10 text-red-200 border-l-2 border-red-500/40";
      const lineClass =
        line.type === "added" || line.type === "removed"
          ? highlightClass
          : line.type === "empty"
          ? "text-slate-500 border-l-2 border-transparent"
          : "text-slate-300 border-l-2 border-transparent";

      const lineNumber = line.lineNumber ? line.lineNumber.toString() : "";
      const lineText = line.text.length > 0 ? line.text : " ";

      return (
        <div key={index} className={`flex ${lineClass}`}>
          <span className="text-slate-500 text-xs w-10 text-right pr-2 select-none">
            {lineNumber}
          </span>
          <span className="text-xs font-mono flex-1 whitespace-pre leading-5">
            {lineText}
          </span>
        </div>
      );
    });
  };

  return (
    <div className="space-y-6">
      {/* PR Loading */}
      {!reviewDetails && (
        <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
          <h2 className="text-slate-100 font-semibold mb-6 flex items-center gap-2">
            <i className="fas fa-code-branch text-indigo-400 text-xs"></i>
            Load Pull Request for Review & Analysis
          </h2>

          <div className="space-y-4">
            {/* PR URL Input */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  PR URL (auto-fills all fields)
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setPrUrl("");
                    setOrganization("");
                    setProject("");
                    setRepository("");
                    setPullRequestId("");
                  }}
                  className="text-xs text-slate-400 hover:text-slate-300"
                >
                  Clear
                </button>
              </div>
              <input
                type="text"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                placeholder="https://dev.azure.com/org/project/_git/repo/pullrequest/12345"
                className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                  Organization
                </label>
                <input
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="org-name"
                  className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                  Project
                </label>
                <input
                  type="text"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="project-name"
                  className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                  Repository
                </label>
                <input
                  type="text"
                  value={repository}
                  onChange={(e) => setRepository(e.target.value)}
                  placeholder="repo-name"
                  className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                  PR ID
                </label>
                <input
                  type="text"
                  value={pullRequestId}
                  onChange={(e) => setPullRequestId(e.target.value)}
                  placeholder="12345"
                  className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
            </div>

            <button
              onClick={loadPRDetails}
              disabled={
                !organization || !project || !repository || !pullRequestId
              }
              className="w-full py-3 rounded-lg font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/10"
            >
              Load PR for Review & Analysis
            </button>
          </div>
        </div>
      )}

      {/* Review & Analysis Interface */}
      {reviewDetails && (
        <>
          {/* PR Header */}
          <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-slate-100 font-semibold flex items-center gap-2">
                <i className="fas fa-code-branch text-indigo-400 text-xs"></i>
                PR Review & Analysis: {reviewDetails.title}
              </h2>
              <span
                className={`text-xs px-2 py-1 rounded ${
                  reviewDetails.status === "active"
                    ? "bg-blue-500/20 text-blue-400"
                    : reviewDetails.status === "completed"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-slate-500/20 text-slate-400"
                }`}
              >
                {reviewDetails.status}
              </span>
            </div>

            {/* Vote Actions */}
            <div className="mb-4">
              <h3 className="text-slate-200 font-medium mb-2">
                Submit Your Review
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <button
                  onClick={() => handleVote(5)}
                  disabled={isSubmittingVote}
                  className="py-2 px-3 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all"
                >
                  <i className="fas fa-check mr-1"></i> Approve
                </button>
                <button
                  onClick={() => handleVote(10)}
                  disabled={isSubmittingVote}
                  className="py-2 px-3 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all"
                >
                  <i className="fas fa-comment mr-1"></i> Approve w/ Suggestions
                </button>
                <button
                  onClick={() => handleVote(-5)}
                  disabled={isSubmittingVote}
                  className="py-2 px-3 rounded-lg text-xs font-medium bg-yellow-600 hover:bg-yellow-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all"
                >
                  <i className="fas fa-hourglass-half mr-1"></i> Wait for Author
                </button>
                <button
                  onClick={() => handleVote(-10)}
                  disabled={isSubmittingVote}
                  className="py-2 px-3 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all"
                >
                  <i className="fas fa-times mr-1"></i> Reject
                </button>
              </div>
            </div>
          </div>

          {/* File Selection */}
          <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
            <h3 className="text-slate-200 font-medium mb-4">
              Select File to Analyze
            </h3>
            <div className="space-y-2">
              <select
                value={selectedFile?.path || ""}
                onChange={(e) => {
                  const file = fileDiffs.find((f) => f.path === e.target.value);
                  setSelectedFile(file || null);
                  setAnalysis(null);
                  setIsDiffModalOpen(!!file);
                }}
                className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
              >
                <option value="">Select a file...</option>
                {fileDiffs.map((file) => (
                  <option key={file.path} value={file.path}>
                    {file.path} ({file.changeType})
                  </option>
                ))}
              </select>

              {selectedFile && (
                <div className="flex gap-2">
                  <button
                    onClick={analyzeFileChanges}
                    disabled={isAnalyzing}
                    className="flex-1 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all"
                  >
                    {isAnalyzing ? (
                      <>
                        <i className="fas fa-circle-notch fa-spin mr-2"></i>
                        Analyzing Changes...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-search mr-2"></i>
                        Analyze Changes
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => setIsDiffModalOpen(true)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-all"
                  >
                    <i className="fas fa-code mr-2"></i>
                    View Diff
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Two-Column Diff View Modal */}
          {selectedFile && isDiffModalOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
              onClick={() => setIsDiffModalOpen(false)}
            >
              <div
                className="relative bg-[#111113] border border-white/5 rounded-xl shadow-xl w-[80vw] h-[80vh] flex flex-col"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
                  <div className="min-w-0">
                    <h3 className="text-slate-200 font-medium truncate">
                      Code Changes: {selectedFile.path}
                    </h3>
                    {isFormatting && (
                      <div className="text-xs text-slate-500 mt-1">
                        Formatting with Prettier...
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setIsDiffModalOpen(false)}
                    className="text-slate-400 hover:text-slate-200 text-sm"
                    aria-label="Close diff modal"
                  >
                    <i className="fas fa-times"></i>
                  </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 flex-1 min-h-0">
                  {/* Source Column */}
                  <div className="flex flex-col min-h-0">
                    <div className="mb-3 flex items-center gap-2">
                      <h4 className="text-slate-300 font-medium">
                        Source Branch
                      </h4>
                      <span className="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded">
                        {reviewDetails.sourceRefName.replace(
                          "refs/heads/",
                          ""
                        )}
                      </span>
                    </div>
                    <div className="bg-[#0a0a0b] border border-white/10 rounded-lg p-4 flex-1 overflow-auto">
                      <div className="text-xs text-slate-500 mb-2">
                        Source Code
                      </div>
                      <div className="font-mono text-xs text-slate-300 leading-5">
                        {renderDiffLines(diffLines.left, "left")}
                      </div>
                    </div>
                  </div>

                  {/* Target Column */}
                  <div className="flex flex-col min-h-0">
                    <div className="mb-3 flex items-center gap-2">
                      <h4 className="text-slate-300 font-medium">
                        Target Branch
                      </h4>
                      <span className="text-xs bg-red-500/20 text-red-300 px-2 py-1 rounded">
                        {reviewDetails.targetRefName.replace(
                          "refs/heads/",
                          ""
                        )}
                      </span>
                    </div>
                    <div className="bg-[#0a0a0b] border border-white/10 rounded-lg p-4 flex-1 overflow-auto">
                      <div className="text-xs text-slate-500 mb-2">
                        Target Code
                      </div>
                      <div className="font-mono text-xs text-slate-300 leading-5">
                        {renderDiffLines(diffLines.right, "right")}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AI Analysis Results */}
          {analysis && (
            <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
              <h3 className="text-slate-200 font-medium mb-4">
                AI Analysis Results
              </h3>
              <div className="space-y-4">
                <div>
                  <h4 className="text-slate-300 font-medium mb-2">Summary</h4>
                  <p className="text-sm text-slate-300">{analysis.summary}</p>
                </div>

                <div>
                  <h4 className="text-slate-300 font-medium mb-2">
                    Key Points
                  </h4>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.keyPoints?.map((point: string, index: number) => (
                      <li key={index} className="text-sm text-slate-300">
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-slate-300 font-medium mb-2">
                    Security Concerns
                  </h4>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.securityConcerns?.map(
                      (concern: string, index: number) => (
                        <li key={index} className="text-sm text-red-400">
                          {concern}
                        </li>
                      )
                    )}
                  </ul>
                </div>

                <div>
                  <h4 className="text-slate-300 font-medium mb-2">
                    Performance Tips
                  </h4>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.performanceTips?.map(
                      (tip: string, index: number) => (
                        <li key={index} className="text-sm text-yellow-400">
                          {tip}
                        </li>
                      )
                    )}
                  </ul>
                </div>

                <div>
                  <h4 className="text-slate-300 font-medium mb-2">
                    Code Review Comments
                  </h4>
                  <ul className="list-disc list-inside space-y-1">
                    {analysis.codeReviewComments?.map(
                      (comment: any, index: number) => (
                        <li key={index} className="text-sm text-slate-300">
                          <span className="font-medium">{comment.file}:</span>{" "}
                          {comment.comment}
                        </li>
                      )
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Add Comment */}
          <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
            <h3 className="text-slate-200 font-medium mb-4">Add Comment</h3>
            <div className="space-y-4">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Your review comment..."
                rows={3}
                className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all resize-none"
                disabled={isSubmittingComment}
              />

              <button
                onClick={handleAddComment}
                disabled={isSubmittingComment || !newComment.trim()}
                className="w-full py-2.5 rounded-lg font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/10"
              >
                {isSubmittingComment ? (
                  <>
                    <i className="fas fa-circle-notch fa-spin mr-2"></i>
                    Adding Comment...
                  </>
                ) : (
                  "Add Comment"
                )}
              </button>
            </div>
          </div>

          {/* Review Threads */}
          {reviewDetails.threads.length > 0 && (
            <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
              <h3 className="text-slate-200 font-medium mb-4">
                Review Comments ({reviewDetails.threads.length})
              </h3>
              <div className="space-y-4">
                {reviewDetails.threads.map((thread) => (
                  <div
                    key={thread.id}
                    className="border border-white/5 rounded-lg p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {thread.threadContext && (
                          <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">
                            {thread.threadContext.filePath}
                            {thread.threadContext.rightFileStart &&
                              `:${thread.threadContext.rightFileStart.line}`}
                          </span>
                        )}
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            getThreadStatus(thread.status).color
                          } bg-opacity-20`}
                        >
                          {getThreadStatus(thread.status).text}
                        </span>
                      </div>
                      <select
                        value={thread.status}
                        onChange={(e) =>
                          handleUpdateThreadStatus(
                            thread.id,
                            e.target.value as any
                          )
                        }
                        className="text-xs bg-[#0a0a0b] border border-white/10 rounded px-2 py-1 text-slate-300"
                      >
                        <option value="active">Active</option>
                        <option value="fixed">Fixed</option>
                        <option value="wontFix">Won't Fix</option>
                        <option value="closed">Closed</option>
                        <option value="byDesign">By Design</option>
                      </select>
                    </div>

                    <div className="space-y-3">
                      {thread.comments.map((comment) => (
                        <div
                          key={comment.id}
                          className="border-l-2 border-indigo-500/30 pl-3"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-medium text-slate-200">
                              {comment.author.displayName}
                            </span>
                            <span className="text-xs text-slate-500">
                              {new Date(comment.publishedDate).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm text-slate-300 whitespace-pre-wrap">
                            {comment.content}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-3 pt-3 border-t border-white/5">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={replyContent[thread.id] || ""}
                          onChange={(e) =>
                            setReplyContent((prev) => ({
                              ...prev,
                              [thread.id]: e.target.value,
                            }))
                          }
                          placeholder="Reply to this comment..."
                          className="flex-1 bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                        />
                        <button
                          onClick={() => handleReply(thread.id)}
                          disabled={!replyContent[thread.id]?.trim()}
                          className="px-4 py-2 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all"
                        >
                          Reply
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PRReviewAnalysis;

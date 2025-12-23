import React, { useState, useEffect } from "react";
import {
  PRReviewParams,
  PRReviewDetails,
  PRReviewState,
  AzureDevOpsParams,
} from "../types.ts";
import {
  getPRReviewDetails,
  submitPRVote,
  createPRComment,
  replyToPRComment,
  updateThreadStatus,
  getPRFiles,
  getFileContent,
  getVoteStatus,
  getThreadStatus,
} from "../services/prReviewService.ts";

function parsePRUrl(url: string): AzureDevOpsParams | null {
  try {
    const prUrl = new URL(url);
    const pathParts = prUrl.pathname.split("/").filter((p) => p !== "");

    // Support for dev.azure.com
    if (
      pathParts.length >= 6 &&
      pathParts[2] === "_git" &&
      pathParts[4] === "pullrequest"
    ) {
      return {
        organization: pathParts[0],
        project: pathParts[1],
        repository: pathParts[3],
        pullRequestId: pathParts[5],
      };
    }

    // Support for organization.visualstudio.com
    const hostParts = prUrl.hostname.split(".");
    if (hostParts[1] === "visualstudio" && pathParts[1] === "_git") {
      return {
        organization: hostParts[0],
        project: pathParts[0],
        repository: pathParts[2],
        pullRequestId: pathParts[4],
      };
    }
    return null;
  } catch {
    return null;
  }
}

interface PRReviewFormProps {
  pat: string;
  onReviewSuccess: (details: PRReviewDetails) => void;
}

const PRReviewForm: React.FC<PRReviewFormProps> = ({
  pat,
  onReviewSuccess,
}) => {
  const [prUrl, setPrUrl] = useState("");
  const [organization, setOrganization] = useState("");
  const [project, setProject] = useState("");
  const [repository, setRepository] = useState("");
  const [pullRequestId, setPullRequestId] = useState("");
  const [state, setState] = useState<PRReviewState>({
    isLoading: false,
    error: null,
    reviewDetails: null,
    isSubmittingVote: false,
    isSubmittingComment: false,
  });

  const [newComment, setNewComment] = useState("");
  const [selectedFile, setSelectedFile] = useState("");
  const [lineNumber, setLineNumber] = useState("");
  const [replyContent, setReplyContent] = useState<{
    [threadId: number]: string;
  }>({});
  const [fileContents, setFileContents] = useState<{
    [filePath: string]: string;
  }>({});

  const loadReviewDetails = async () => {
    if (!organization || !project || !repository || !pullRequestId || !pat) {
      setState((prev) => ({
        ...prev,
        error: "All fields are required to load PR details.",
      }));
      return;
    }

    const prId = parseInt(pullRequestId);
    if (isNaN(prId)) {
      setState((prev) => ({
        ...prev,
        error: "Pull Request ID must be a valid number.",
      }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: prId,
      };

      const details = await getPRReviewDetails(params, pat);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        reviewDetails: details,
      }));
      onReviewSuccess(details);
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error.message || "Failed to load PR details.",
      }));
    }
  };

  const handleVote = async (vote: number) => {
    if (!state.reviewDetails) return;

    setState((prev) => ({ ...prev, isSubmittingVote: true }));

    try {
      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: state.reviewDetails.pullRequestId,
      };

      await submitPRVote(params, pat, vote);

      // Refresh the review details to show updated vote
      const updatedDetails = await getPRReviewDetails(params, pat);
      setState((prev) => ({
        ...prev,
        isSubmittingVote: false,
        reviewDetails: updatedDetails,
      }));
      onReviewSuccess(updatedDetails);
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        isSubmittingVote: false,
        error: error.message || "Failed to submit vote.",
      }));
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || !state.reviewDetails) return;

    setState((prev) => ({ ...prev, isSubmittingComment: true }));

    try {
      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: state.reviewDetails.pullRequestId,
      };

      const threadContext = selectedFile
        ? {
            filePath: selectedFile,
            lineNumber: lineNumber ? parseInt(lineNumber) : undefined,
          }
        : undefined;

      await createPRComment(params, pat, newComment, threadContext);

      // Refresh the review details
      const updatedDetails = await getPRReviewDetails(params, pat);
      setState((prev) => ({
        ...prev,
        isSubmittingComment: false,
        reviewDetails: updatedDetails,
      }));
      onReviewSuccess(updatedDetails);

      // Clear form
      setNewComment("");
      setSelectedFile("");
      setLineNumber("");
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        isSubmittingComment: false,
        error: error.message || "Failed to add comment.",
      }));
    }
  };

  const handleReply = async (threadId: number) => {
    const reply = replyContent[threadId];
    if (!reply?.trim() || !state.reviewDetails) return;

    try {
      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: state.reviewDetails.pullRequestId,
      };

      await replyToPRComment(params, pat, threadId, reply);

      // Refresh the review details
      const updatedDetails = await getPRReviewDetails(params, pat);
      setState((prev) => ({
        ...prev,
        reviewDetails: updatedDetails,
      }));
      onReviewSuccess(updatedDetails);

      // Clear reply
      setReplyContent((prev) => ({ ...prev, [threadId]: "" }));
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        error: error.message || "Failed to reply to comment.",
      }));
    }
  };

  const handleUpdateThreadStatus = async (
    threadId: number,
    status: "active" | "fixed" | "wontFix" | "closed" | "byDesign"
  ) => {
    if (!state.reviewDetails) return;

    try {
      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: state.reviewDetails.pullRequestId,
      };

      await updateThreadStatus(params, pat, threadId, status);

      // Refresh the review details
      const updatedDetails = await getPRReviewDetails(params, pat);
      setState((prev) => ({
        ...prev,
        reviewDetails: updatedDetails,
      }));
      onReviewSuccess(updatedDetails);
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        error: error.message || "Failed to update thread status.",
      }));
    }
  };

  const loadFileContent = async (filePath: string) => {
    if (fileContents[filePath] || !state.reviewDetails) return;

    try {
      const params: PRReviewParams = {
        organization,
        project,
        repository,
        pullRequestId: state.reviewDetails.pullRequestId,
      };

      const content = await getFileContent(params, pat, filePath);
      setFileContents((prev) => ({ ...prev, [filePath]: content }));
    } catch (error: any) {
      console.error("Failed to load file content:", error);
    }
  };

  // Load files when PR details are available
  useEffect(() => {
    if (state.reviewDetails && organization && project && repository && pat) {
      const loadFiles = async () => {
        try {
          const params: PRReviewParams = {
            organization,
            project,
            repository,
            pullRequestId: state.reviewDetails!.pullRequestId,
          };

          const files = await getPRFiles(params, pat);
          // You could store these in state if needed for a dropdown
        } catch (error) {
          console.error("Failed to load files:", error);
        }
      };

      loadFiles();
    }
  }, [state.reviewDetails, organization, project, repository, pat]);

  return (
    <div className="space-y-6">
      {/* PR Loading Form */}
      {!state.reviewDetails && (
        <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
          <h2 className="text-slate-100 font-semibold mb-6 flex items-center gap-2">
            <i className="fas fa-code-branch text-indigo-400 text-xs"></i>
            Load Pull Request for Review
          </h2>

          <div className="space-y-4">
            {/* PR URL Input */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  PR URL (Optional - auto-fills all fields)
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
                disabled={state.isLoading}
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
                  disabled={state.isLoading}
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
                  disabled={state.isLoading}
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
                  disabled={state.isLoading}
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
                  disabled={state.isLoading}
                />
              </div>
            </div>

            {state.error && (
              <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-3 text-rose-400 flex items-start gap-2">
                <i className="fas fa-exclamation-triangle mt-0.5"></i>
                <p className="text-sm">{state.error}</p>
              </div>
            )}

            <button
              onClick={loadReviewDetails}
              disabled={state.isLoading}
              className="w-full py-3 rounded-lg font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/10"
            >
              {state.isLoading ? (
                <>
                  <i className="fas fa-circle-notch fa-spin mr-2"></i>
                  Loading PR...
                </>
              ) : (
                "Load PR Details"
              )}
            </button>
          </div>
        </div>
      )}

      {/* PR Review Details */}
      {state.reviewDetails && (
        <>
          {/* PR Header */}
          <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-slate-100 font-semibold flex items-center gap-2">
                <i className="fas fa-code-branch text-indigo-400 text-xs"></i>
                PR Review: {state.reviewDetails.title}
              </h2>
              <span
                className={`text-xs px-2 py-1 rounded ${
                  state.reviewDetails.status === "active"
                    ? "bg-blue-500/20 text-blue-400"
                    : state.reviewDetails.status === "completed"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-slate-500/20 text-slate-400"
                }`}
              >
                {state.reviewDetails.status}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
              <div>
                <span className="text-slate-500 text-xs uppercase tracking-wider">
                  PR ID
                </span>
                <p className="text-slate-200 font-medium">
                  #{state.reviewDetails.pullRequestId}
                </p>
              </div>
              <div>
                <span className="text-slate-500 text-xs uppercase tracking-wider">
                  Created By
                </span>
                <p className="text-slate-200 font-medium">
                  {state.reviewDetails.createdBy.displayName}
                </p>
              </div>
              <div>
                <span className="text-slate-500 text-xs uppercase tracking-wider">
                  Source Branch
                </span>
                <p className="text-slate-200 font-medium">
                  {state.reviewDetails.sourceRefName.replace("refs/heads/", "")}
                </p>
              </div>
              <div>
                <span className="text-slate-500 text-xs uppercase tracking-wider">
                  Target Branch
                </span>
                <p className="text-slate-200 font-medium">
                  {state.reviewDetails.targetRefName.replace("refs/heads/", "")}
                </p>
              </div>
            </div>

            {/* Reviewers */}
            <div className="mb-4">
              <h3 className="text-slate-200 font-medium mb-2">Reviewers</h3>
              <div className="space-y-2">
                {state.reviewDetails.reviewers.map((reviewer, index) => {
                  const voteStatus = getVoteStatus(reviewer.vote);
                  return (
                    <div
                      key={index}
                      className="flex items-center justify-between text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-slate-200">
                          {reviewer.reviewer.displayName}
                        </span>
                        {reviewer.isRequired && (
                          <span className="text-xs bg-rose-500/20 text-rose-400 px-2 py-0.5 rounded">
                            Required
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-xs font-medium flex items-center gap-1 ${voteStatus.color}`}
                      >
                        <i className={`fas ${voteStatus.icon}`}></i>
                        {voteStatus.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Vote Actions */}
            <div className="border-t border-white/5 pt-4">
              <h3 className="text-slate-200 font-medium mb-2">
                Submit Your Review
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <button
                  onClick={() => handleVote(5)}
                  disabled={state.isSubmittingVote}
                  className="py-2 px-3 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all"
                >
                  <i className="fas fa-check mr-1"></i> Approve
                </button>
                <button
                  onClick={() => handleVote(10)}
                  disabled={state.isSubmittingVote}
                  className="py-2 px-3 rounded-lg text-xs font-medium bg-green-600 hover:bg-green-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all"
                >
                  <i className="fas fa-comment mr-1"></i> Approve w/ Suggestions
                </button>
                <button
                  onClick={() => handleVote(-5)}
                  disabled={state.isSubmittingVote}
                  className="py-2 px-3 rounded-lg text-xs font-medium bg-yellow-600 hover:bg-yellow-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all"
                >
                  <i className="fas fa-hourglass-half mr-1"></i> Wait for Author
                </button>
                <button
                  onClick={() => handleVote(-10)}
                  disabled={state.isSubmittingVote}
                  className="py-2 px-3 rounded-lg text-xs font-medium bg-red-600 hover:bg-red-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all"
                >
                  <i className="fas fa-times mr-1"></i> Reject
                </button>
              </div>
            </div>
          </div>

          {/* Add Comment */}
          <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
            <h3 className="text-slate-200 font-medium mb-4">Add Comment</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                  Comment
                </label>
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Your review comment..."
                  rows={3}
                  className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all resize-none"
                  disabled={state.isSubmittingComment}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                    File Path (Optional)
                  </label>
                  <input
                    type="text"
                    value={selectedFile}
                    onChange={(e) => setSelectedFile(e.target.value)}
                    placeholder="src/components/App.tsx"
                    className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                    disabled={state.isSubmittingComment}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                    Line Number (Optional)
                  </label>
                  <input
                    type="text"
                    value={lineNumber}
                    onChange={(e) => setLineNumber(e.target.value)}
                    placeholder="42"
                    className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                    disabled={state.isSubmittingComment}
                  />
                </div>
              </div>

              <button
                onClick={handleAddComment}
                disabled={state.isSubmittingComment || !newComment.trim()}
                className="w-full py-2.5 rounded-lg font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/10"
              >
                {state.isSubmittingComment ? (
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
          {state.reviewDetails.threads.length > 0 && (
            <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
              <h3 className="text-slate-200 font-medium mb-4">
                Review Comments ({state.reviewDetails.threads.length})
              </h3>
              <div className="space-y-4">
                {state.reviewDetails.threads.map((thread) => (
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
                      <div className="flex gap-1">
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

                    {/* Reply Form */}
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

      {/* Error Display */}
      {state.error && (
        <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-5 text-rose-400 flex items-start gap-3">
          <i className="fas fa-exclamation-triangle mt-1"></i>
          <div>
            <h4 className="font-bold text-xs uppercase mb-1">Error</h4>
            <p className="text-sm opacity-80">{state.error}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PRReviewForm;

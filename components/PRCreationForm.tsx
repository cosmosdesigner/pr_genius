import React, { useState, useEffect } from "react";
import { PRCreateParams, PRCreateResult, PRCreateState } from "../types.ts";
import {
  createPR,
  validateBranchExists,
  getRepositoryBranches,
  parsePRUrl,
} from "../services/prCreationService.ts";

interface PRCreationFormProps {
  pat: string;
  onCreateSuccess: (result: PRCreateResult) => void;
}

const PRCreationForm: React.FC<PRCreationFormProps> = ({
  pat,
  onCreateSuccess,
}) => {
  const [prUrl, setPrUrl] = useState("");
  const [organization, setOrganization] = useState("");
  const [project, setProject] = useState("");
  const [repository, setRepository] = useState("");
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("main");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requiredReviewers, setRequiredReviewers] = useState("");
  const [optionalReviewers, setOptionalReviewers] = useState("");
  const [workItems, setWorkItems] = useState("");
  const [autoComplete, setAutoComplete] = useState(true);
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(true);
  const [mergeStrategy, setMergeStrategy] = useState<
    "squash" | "merge" | "rebase"
  >("squash");

  const [availableBranches, setAvailableBranches] = useState<string[]>([]);
  const [branchValidation, setBranchValidation] = useState<{
    source: boolean;
    target: boolean;
  }>({ source: false, target: false });
  const [state, setState] = useState<PRCreateState>({
    isCreating: false,
    error: null,
    result: null,
  });

  // Parse PR URL when provided
  useEffect(() => {
    if (prUrl) {
      const params = parsePRUrl(prUrl);
      if (params) {
        setOrganization(params.organization);
        setProject(params.project);
        setRepository(params.repository);
        setTargetBranch("main"); // Default to main for new PRs
      }
    }
  }, [prUrl]);

  // Load branches when organization, project, and repository are provided
  useEffect(() => {
    if (organization && project && repository && pat) {
      loadBranches();
    }
  }, [organization, project, repository, pat]);

  // Validate branches when they change
  useEffect(() => {
    if (sourceBranch && organization && project && repository && pat) {
      validateBranch(sourceBranch, "source");
    }
  }, [sourceBranch, organization, project, repository, pat]);

  useEffect(() => {
    if (targetBranch && organization && project && repository && pat) {
      validateBranch(targetBranch, "target");
    }
  }, [targetBranch, organization, project, repository, pat]);

  const loadBranches = async () => {
    try {
      const branches = await getRepositoryBranches(
        organization,
        project,
        repository,
        pat
      );
      setAvailableBranches(branches);
    } catch (error) {
      console.error("Failed to load branches:", error);
    }
  };

  const validateBranch = async (
    branchName: string,
    type: "source" | "target"
  ) => {
    try {
      const exists = await validateBranchExists(
        organization,
        project,
        repository,
        branchName,
        pat
      );
      setBranchValidation((prev) => ({ ...prev, [type]: exists }));
    } catch (error) {
      setBranchValidation((prev) => ({ ...prev, [type]: false }));
    }
  };

  const generateTitleFromBranch = () => {
    if (!sourceBranch) return;

    // Extract ticket number and description from branch name
    // Example: feature/12345-short-desc becomes "12345: short desc"
    const branchParts = sourceBranch.split("/");
    const branchName = branchParts[branchParts.length - 1];
    const ticketMatch = branchName.match(/^(\d+)-(.+)$/);

    if (ticketMatch) {
      const ticket = ticketMatch[1];
      const desc = ticketMatch[2].replace(/-/g, " ");
      setTitle(`${ticket}: ${desc}`);
    } else {
      setTitle(`PR from ${sourceBranch}`);
    }
  };

  const generateDefaultDescription = () => {
    setDescription(
      `## Changes\n\n## Checklist\n- [ ] Code reviewed\n- [ ] Tests pass\n- [ ] Documentation updated`
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !organization ||
      !project ||
      !repository ||
      !sourceBranch ||
      !targetBranch ||
      !title
    ) {
      setState((prev) => ({
        ...prev,
        error:
          "Organization, project, repository, source branch, target branch, and title are required.",
      }));
      return;
    }

    if (!branchValidation.source) {
      setState((prev) => ({
        ...prev,
        error: "Source branch does not exist or you don't have access to it.",
      }));
      return;
    }

    if (!branchValidation.target) {
      setState((prev) => ({
        ...prev,
        error: "Target branch does not exist or you don't have access to it.",
      }));
      return;
    }

    setState((prev) => ({ ...prev, isCreating: true, error: null }));

    try {
      const params: PRCreateParams = {
        organization,
        project,
        repository,
        sourceBranch,
        targetBranch,
        title,
        description,
        requiredReviewers: requiredReviewers
          ? requiredReviewers.split(",").map((r) => r.trim())
          : [],
        optionalReviewers: optionalReviewers
          ? optionalReviewers.split(",").map((r) => r.trim())
          : [],
        workItems: workItems
          ? workItems
              .split(",")
              .map((w) => parseInt(w.trim()))
              .filter((w) => !isNaN(w))
          : [],
        autoComplete,
        deleteSourceBranch,
        mergeStrategy,
      };

      const result = await createPR(params, pat);
      setState((prev) => ({ ...prev, isCreating: false, result }));
      onCreateSuccess(result);
    } catch (error: any) {
      setState((prev) => ({
        ...prev,
        isCreating: false,
        error: error.message || "Failed to create PR.",
      }));
    }
  };

  return (
    <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
      <h2 className="text-slate-100 font-semibold mb-6 flex items-center gap-2">
        <i className="fas fa-code-branch text-indigo-400 text-xs"></i>
        Create Pull Request
      </h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* PR URL Input */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              PR URL (Optional - auto-fills repository info)
            </label>
            <button
              type="button"
              onClick={() => {
                setPrUrl("");
                setOrganization("");
                setProject("");
                setRepository("");
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
            disabled={state.isCreating}
          />
        </div>

        {/* Repository Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              disabled={state.isCreating}
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
              disabled={state.isCreating}
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
              disabled={state.isCreating}
            />
          </div>
        </div>

        {/* Branch Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
              Source Branch
              {sourceBranch && (
                <span
                  className={`ml-2 text-xs ${
                    branchValidation.source ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {branchValidation.source ? "✓" : "✗"}
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type="text"
                value={sourceBranch}
                onChange={(e) => setSourceBranch(e.target.value)}
                placeholder="feature/12345-short-desc"
                className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                disabled={state.isCreating}
              />
              {availableBranches.length > 0 && (
                <datalist id="source-branches">
                  {availableBranches.map((branch) => (
                    <option key={branch} value={branch} />
                  ))}
                </datalist>
              )}
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
              Target Branch
              {targetBranch && (
                <span
                  className={`ml-2 text-xs ${
                    branchValidation.target ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {branchValidation.target ? "✓" : "✗"}
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type="text"
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                placeholder="main"
                className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                disabled={state.isCreating}
              />
              {availableBranches.length > 0 && (
                <datalist id="target-branches">
                  {availableBranches.map((branch) => (
                    <option key={branch} value={branch} />
                  ))}
                </datalist>
              )}
            </div>
          </div>
        </div>

        {/* PR Details */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Title
            </label>
            <button
              type="button"
              onClick={generateTitleFromBranch}
              className="text-xs text-indigo-400 hover:text-indigo-300"
              disabled={!sourceBranch || state.isCreating}
            >
              Generate from branch
            </button>
          </div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="PR title"
            className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
            disabled={state.isCreating}
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Description
            </label>
            <button
              type="button"
              onClick={generateDefaultDescription}
              className="text-xs text-indigo-400 hover:text-indigo-300"
              disabled={state.isCreating}
            >
              Use template
            </button>
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="PR description"
            rows={4}
            className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all resize-none"
            disabled={state.isCreating}
          />
        </div>

        {/* Reviewers */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
              Required Reviewers
            </label>
            <input
              type="text"
              value={requiredReviewers}
              onChange={(e) => setRequiredReviewers(e.target.value)}
              placeholder="user1@company.com, user2@company.com"
              className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
              disabled={state.isCreating}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
              Optional Reviewers
            </label>
            <input
              type="text"
              value={optionalReviewers}
              onChange={(e) => setOptionalReviewers(e.target.value)}
              placeholder="pm@company.com, qa@company.com"
              className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
              disabled={state.isCreating}
            />
          </div>
        </div>

        {/* Work Items */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
            Work Items
          </label>
          <input
            type="text"
            value={workItems}
            onChange={(e) => setWorkItems(e.target.value)}
            placeholder="12345, 67890"
            className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
            disabled={state.isCreating}
          />
        </div>

        {/* Merge Settings */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
              Merge Strategy
            </label>
            <select
              value={mergeStrategy}
              onChange={(e) =>
                setMergeStrategy(
                  e.target.value as "squash" | "merge" | "rebase"
                )
              }
              className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
              disabled={state.isCreating}
            >
              <option value="squash">Squash</option>
              <option value="merge">Merge Commit</option>
              <option value="rebase">Rebase</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="autoComplete"
              checked={autoComplete}
              onChange={(e) => setAutoComplete(e.target.checked)}
              className="rounded border-white/10 bg-[#0a0a0b] text-indigo-600 focus:ring-indigo-500"
              disabled={state.isCreating}
            />
            <label htmlFor="autoComplete" className="text-sm text-slate-300">
              Auto-complete
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="deleteSourceBranch"
              checked={deleteSourceBranch}
              onChange={(e) => setDeleteSourceBranch(e.target.checked)}
              className="rounded border-white/10 bg-[#0a0a0b] text-indigo-600 focus:ring-indigo-500"
              disabled={state.isCreating}
            />
            <label
              htmlFor="deleteSourceBranch"
              className="text-sm text-slate-300"
            >
              Delete source branch
            </label>
          </div>
        </div>

        {/* Error Display */}
        {state.error && (
          <div className="bg-rose-500/5 border border-rose-500/20 rounded-lg p-3 text-rose-400 flex items-start gap-2">
            <i className="fas fa-exclamation-triangle mt-0.5"></i>
            <p className="text-sm">{state.error}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={state.isCreating}
          className="w-full py-3 rounded-lg font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/10"
        >
          {state.isCreating ? (
            <>
              <i className="fas fa-circle-notch fa-spin mr-2"></i>
              Creating PR...
            </>
          ) : (
            "Create Pull Request"
          )}
        </button>
      </form>
    </div>
  );
};

export default PRCreationForm;

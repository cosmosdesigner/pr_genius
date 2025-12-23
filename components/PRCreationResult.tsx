import React from "react";
import { PRCreateResult } from "../types.ts";

interface PRCreationResultProps {
  result: PRCreateResult;
  onReset: () => void;
}

const PRCreationResult: React.FC<PRCreationResultProps> = ({
  result,
  onReset,
}) => {
  const getVoteStatus = (vote: number) => {
    switch (vote) {
      case 0:
        return { text: "No vote", color: "text-slate-400" };
      case 5:
        return { text: "Approved", color: "text-green-400" };
      case 10:
        return { text: "Approved with suggestions", color: "text-green-400" };
      case -5:
        return { text: "Waiting for author", color: "text-yellow-400" };
      case -10:
        return { text: "Rejected", color: "text-red-400" };
      default:
        return { text: "Unknown", color: "text-slate-400" };
    }
  };

  const openPRInBrowser = () => {
    window.open(result.url, "_blank");
  };

  return (
    <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-slate-100 font-semibold flex items-center gap-2">
          <i className="fas fa-check-circle text-green-400 text-xs"></i>
          Pull Request Created Successfully
        </h2>
        <button
          onClick={onReset}
          className="text-xs text-slate-400 hover:text-slate-300 transition-colors"
        >
          <i className="fas fa-times mr-1"></i>
          Close
        </button>
      </div>

      <div className="space-y-4">
        {/* PR Details */}
        <div className="bg-[#0a0a0b] border border-white/5 rounded-lg p-4">
          <h3 className="text-slate-200 font-medium mb-3">PR Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500 text-xs uppercase tracking-wider">
                PR ID
              </span>
              <p className="text-slate-200 font-medium">
                #{result.pullRequestId}
              </p>
            </div>
            <div>
              <span className="text-slate-500 text-xs uppercase tracking-wider">
                Status
              </span>
              <p className="text-slate-200 font-medium capitalize">
                {result.status}
              </p>
            </div>
            <div>
              <span className="text-slate-500 text-xs uppercase tracking-wider">
                Created By
              </span>
              <p className="text-slate-200 font-medium">
                {result.createdBy.displayName}
              </p>
            </div>
            <div>
              <span className="text-slate-500 text-xs uppercase tracking-wider">
                Created Date
              </span>
              <p className="text-slate-200 font-medium">
                {new Date(result.creationDate).toLocaleString()}
              </p>
            </div>
            <div>
              <span className="text-slate-500 text-xs uppercase tracking-wider">
                Source Branch
              </span>
              <p className="text-slate-200 font-medium">
                {result.sourceRefName.replace("refs/heads/", "")}
              </p>
            </div>
            <div>
              <span className="text-slate-500 text-xs uppercase tracking-wider">
                Target Branch
              </span>
              <p className="text-slate-200 font-medium">
                {result.targetRefName.replace("refs/heads/", "")}
              </p>
            </div>
          </div>
        </div>

        {/* Reviewers */}
        {result.reviewers && result.reviewers.length > 0 && (
          <div className="bg-[#0a0a0b] border border-white/5 rounded-lg p-4">
            <h3 className="text-slate-200 font-medium mb-3">Reviewers</h3>
            <div className="space-y-2">
              {result.reviewers.map((reviewer, index) => {
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
                    <span className={`text-xs font-medium ${voteStatus.color}`}>
                      {voteStatus.text}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={openPRInBrowser}
            className="flex-1 py-2.5 rounded-lg font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/10"
          >
            <i className="fas fa-external-link-alt mr-2"></i>
            Open in Browser
          </button>
          <button
            onClick={() => navigator.clipboard.writeText(result.url)}
            className="px-4 py-2.5 rounded-lg font-bold text-sm bg-[#0a0a0b] border border-white/10 text-slate-300 hover:border-white/20 transition-all"
          >
            <i className="fas fa-copy"></i>
          </button>
        </div>

        {/* PR URL */}
        <div className="bg-[#0a0a0b] border border-white/5 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-slate-500 text-xs uppercase tracking-wider">
              PR URL
            </span>
            <button
              onClick={() => navigator.clipboard.writeText(result.url)}
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <i className="fas fa-clipboard mr-1"></i>
              Copy
            </button>
          </div>
          <p className="text-slate-300 text-sm mt-1 break-all">{result.url}</p>
        </div>
      </div>
    </div>
  );
};

export default PRCreationResult;

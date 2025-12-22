import React, { useState, useEffect } from "react";
import {
  parsePRUrl,
  getPRDetails,
  getPRMetadata,
  fetchBatchContents,
} from "./services/azureDevOpsService.ts";
import { analyzeBatch as geminiAnalyzeBatch } from "./services/geminiService.ts";
import { analyzeBatch as glmAnalyzeBatch } from "./services/glmService.ts";
import { AppState, PRAnalysis, AIProvider } from "./types.ts";
import { AnalysisDisplay } from "./components/AnalysisDisplay.tsx";

const App: React.FC = () => {
  const [url, setUrl] = useState("");
  const [pat, setPat] = useState("");
  const [aiProvider, setAiProvider] = useState<AIProvider>(
    (localStorage.getItem("pr_genius_ai_provider") as AIProvider) || "gemini"
  );
  const [systemInstructions, setSystemInstructions] = useState(
    localStorage.getItem("pr_genius_instructions") || ""
  );
  const [systemContext, setSystemContext] = useState(
    localStorage.getItem("pr_genius_context") || ""
  );
  const [state, setState] = useState<AppState>({
    isAnalyzing: false,
    error: null,
    prInfo: null,
    analysis: null,
    allChanges: [],
    processedCount: 0,
    commitId: null,
    params: null,
    systemInstructions: "",
    systemContext: "",
    aiProvider: "gemini",
  });

  useEffect(() => {
    localStorage.setItem("pr_genius_instructions", systemInstructions);
    localStorage.setItem("pr_genius_context", systemContext);
    localStorage.setItem("pr_genius_ai_provider", aiProvider);
  }, [systemInstructions, systemContext, aiProvider]);

  const startAnalysis = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !pat) {
      setState((prev) => ({
        ...prev,
        error: "Pull Request URL and PAT are required.",
      }));
      return;
    }

    const params = parsePRUrl(url);
    if (!params) {
      setState((prev) => ({
        ...prev,
        error: "Invalid Azure DevOps PR URL format.",
      }));
      return;
    }

    setState({
      isAnalyzing: true,
      error: null,
      prInfo: null,
      analysis: null,
      allChanges: [],
      processedCount: 0,
      commitId: null,
      params,
      systemInstructions,
      systemContext,
      aiProvider,
    });

    try {
      const prInfo = await getPRDetails(params, pat);

      if (prInfo.status.toLowerCase() === "abandoned") {
        setState((prev) => ({
          ...prev,
          isAnalyzing: false,
          error: "This PR is abandoned.",
        }));
        return;
      }

      const { commitId, changes } = await getPRMetadata(params, pat);
      if (changes.length === 0) throw new Error("No changes found.");

      const firstBatch = changes.slice(0, 10);
      const fileContents = await fetchBatchContents(
        params,
        pat,
        firstBatch,
        commitId
      );
      const analyzeFunction =
        aiProvider === "glm" ? glmAnalyzeBatch : geminiAnalyzeBatch;
      const initialAnalysis = await analyzeFunction(
        prInfo,
        fileContents,
        0,
        Math.ceil(changes.length / 10),
        systemInstructions,
        systemContext
      );

      setState((prev) => ({
        ...prev,
        isAnalyzing: false,
        error: null,
        prInfo,
        analysis: initialAnalysis,
        allChanges: changes,
        processedCount: firstBatch.length,
        commitId,
      }));
    } catch (err: any) {
      setState((prev) => ({ ...prev, isAnalyzing: false, error: err.message }));
    }
  };

  const loadNextBatch = async () => {
    if (!state.prInfo || !state.allChanges.length || !state.params) return;
    const params = state.params;
    setState((prev) => ({ ...prev, isAnalyzing: true }));

    try {
      const nextBatch = state.allChanges.slice(
        state.processedCount,
        state.processedCount + 10
      );
      const fileContents = await fetchBatchContents(
        params,
        pat,
        nextBatch,
        state.commitId
      );
      const analyzeFunction =
        aiProvider === "glm" ? glmAnalyzeBatch : geminiAnalyzeBatch;
      const batchAnalysis = await analyzeFunction(
        state.prInfo,
        fileContents,
        Math.floor(state.processedCount / 10),
        Math.ceil(state.allChanges.length / 10),
        systemInstructions,
        systemContext
      );

      setState((prev) => {
        const mergedStats = batchAnalysis.stats;

        const merged: PRAnalysis = {
          summary: batchAnalysis.summary,
          overallHealth: batchAnalysis.overallHealth,
          architecturalImpact: batchAnalysis.architecturalImpact,
          contextAlignment: batchAnalysis.contextAlignment,
          stats: mergedStats,
          keyPoints: [
            ...(prev.analysis?.keyPoints || []),
            ...batchAnalysis.keyPoints,
          ],
          securityConcerns: [
            ...(prev.analysis?.securityConcerns || []),
            ...batchAnalysis.securityConcerns,
          ],
          performanceTips: [
            ...(prev.analysis?.performanceTips || []),
            ...batchAnalysis.performanceTips,
          ],
          codeReviewComments: [
            ...(prev.analysis?.codeReviewComments || []),
            ...batchAnalysis.codeReviewComments,
          ],
        };
        return {
          ...prev,
          isAnalyzing: false,
          analysis: merged,
          processedCount: prev.processedCount + nextBatch.length,
        };
      });
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isAnalyzing: false,
        error: `Batch failed: ${err.message}`,
      }));
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b border-white/5 bg-[#0a0a0b]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <i className="fas fa-microchip text-white text-sm"></i>
            </div>
            <h1 className="font-bold text-slate-100 tracking-tight text-sm">
              PR Genius{" "}
              <span className="text-slate-500 font-medium px-2 py-0.5 bg-slate-800 rounded text-[10px] uppercase ml-2">
                Internal Audit
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-medium text-slate-500 uppercase tracking-widest">
            <span>
              Powered by {aiProvider === "glm" ? "GLM-4" : "Gemini 2.5 Flash"}
            </span>
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-[1400px] mx-auto w-full px-6 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-[#111113] border border-white/5 rounded-xl p-6 shadow-sm">
              <h2 className="text-slate-100 font-semibold mb-6 flex items-center gap-2">
                <i className="fas fa-sliders text-indigo-400 text-xs"></i>{" "}
                Configuration
              </h2>

              <form onSubmit={startAnalysis} className="space-y-5">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                    AI Provider
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAiProvider("gemini")}
                      className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                        aiProvider === "gemini"
                          ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
                          : "bg-[#0a0a0b] border border-white/10 text-slate-400 hover:border-white/20"
                      }`}
                      disabled={state.isAnalyzing}
                    >
                      <i className="fas fa-robot mr-1"></i> Gemini
                    </button>
                    <button
                      type="button"
                      onClick={() => setAiProvider("glm")}
                      className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                        aiProvider === "glm"
                          ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20"
                          : "bg-[#0a0a0b] border border-white/10 text-slate-400 hover:border-white/20"
                      }`}
                      disabled={state.isAnalyzing}
                    >
                      <i className="fas fa-brain mr-1"></i> GLM
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                    Azure PR URL
                  </label>
                  <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://dev.azure.com/..."
                    className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                    disabled={state.isAnalyzing}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                    PAT
                  </label>
                  <input
                    type="password"
                    value={pat}
                    onChange={(e) => setPat(e.target.value)}
                    placeholder="Azure DevOps PAT"
                    className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-slate-200 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                    disabled={state.isAnalyzing}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest">
                    Project Style Guide
                  </label>
                  <textarea
                    value={systemInstructions}
                    onChange={(e) => setSystemInstructions(e.target.value)}
                    placeholder="e.g. Use React Hooks. No external libs for state."
                    rows={3}
                    className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-4 py-2.5 text-xs text-slate-400 focus:ring-1 focus:ring-indigo-500 outline-none transition-all resize-none"
                    disabled={state.isAnalyzing}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-widest flex justify-between items-center">
                    System Context
                    <span className="text-[9px] lowercase font-normal opacity-50">
                      API contracts, deps, etc.
                    </span>
                  </label>
                  <textarea
                    value={systemContext}
                    onChange={(e) => setSystemContext(e.target.value)}
                    placeholder="e.g. Service B requires field 'userId'. Shared package 'core-ui' is at v2.3."
                    rows={4}
                    className="w-full bg-[#0a0a0b] border border-white/10 rounded-lg px-4 py-2.5 text-xs text-slate-400 focus:ring-1 focus:ring-indigo-500 outline-none transition-all resize-none"
                    disabled={state.isAnalyzing}
                  />
                </div>
                <button
                  type="submit"
                  disabled={state.isAnalyzing}
                  className="w-full py-3 rounded-lg font-bold text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-800 disabled:text-slate-500 transition-all active:scale-[0.98] shadow-lg shadow-indigo-600/10"
                >
                  {state.isAnalyzing && !state.analysis ? (
                    <>
                      <i className="fas fa-circle-notch fa-spin mr-2"></i>
                      Analyzing...
                    </>
                  ) : (
                    "Analyze Pull Request"
                  )}
                </button>
              </form>
            </div>

            {state.error && (
              <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-5 text-rose-400 flex items-start gap-3">
                <i className="fas fa-exclamation-triangle mt-1"></i>
                <div>
                  <h4 className="font-bold text-xs uppercase mb-1">
                    Configuration Error
                  </h4>
                  <p className="text-sm opacity-80">{state.error}</p>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-8">
            {state.isAnalyzing && !state.analysis ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-16 h-16 relative">
                  <div className="absolute inset-0 border-4 border-indigo-600/20 rounded-full animate-pulse"></div>
                  <div className="absolute inset-0 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
                <h3 className="text-lg font-bold text-slate-200 uppercase tracking-widest">
                  Context-Aware Audit in Progress
                </h3>
              </div>
            ) : state.analysis && state.prInfo && state.params ? (
              <AnalysisDisplay
                analysis={state.analysis}
                prInfo={state.prInfo}
                params={state.params}
                processedCount={state.processedCount}
                totalCount={state.allChanges.length}
                isAnalyzing={state.isAnalyzing}
                onLoadNext={loadNextBatch}
              />
            ) : (
              <div className="h-full min-h-[400px] border border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center text-center p-10">
                <div className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center mb-6 border border-white/5">
                  <i className="fas fa-microchip text-slate-600 text-3xl"></i>
                </div>
                <h2 className="text-xl font-bold text-slate-200 mb-2 tracking-tight">
                  Audit Engine Standby
                </h2>
                <p className="text-slate-500 max-w-sm text-sm">
                  Automated logical, security, and architectural reasoning.
                  Enter context and PR URL to start.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-white/5 py-8 mt-auto bg-[#0a0a0b]">
        <div className="max-w-[1400px] mx-auto px-6 flex justify-between items-center text-[10px] font-bold text-slate-600 uppercase tracking-[0.2em]">
          <span>PR Genius v2.1 Internal Audit</span>
          <span>Security • Architectural Integrity • Performance</span>
        </div>
      </footer>
    </div>
  );
};

export default App;

import {
  PRReviewParams,
  PRReviewDetails,
  PRReviewThread,
  PRReviewVote,
  PRReviewComment,
} from "../types.ts";

async function fetchWithAuth(
  url: string,
  pat: string,
  method: string = "GET",
  body?: any
) {
  const headers = new Headers();
  headers.append("Authorization", `Basic ${btoa(":" + pat)}`);
  headers.append("Content-Type", "application/json");

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  console.log(`Making ${method} request to:`, url);

  const response = await fetch(url, options);

  console.log(`Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Unauthorized: Invalid PAT or insufficient permissions.");
    if (response.status === 403)
      throw new Error(
        'Forbidden: Your PAT might not have "Code (Read & Write)" scope.'
      );
    if (response.status === 404) {
      const errorData = await response.json().catch(() => ({}));
      console.error("404 Error details:", errorData);
      throw new Error(
        `Not Found (404): The PR, repository, or project could not be found. URL: ${url}. Please check the URL and your permissions. ${
          errorData.message || ""
        }`
      );
    }
    const errorData = await response.json().catch(() => ({}));
    console.error("API Error details:", errorData);
    throw new Error(
      `Azure DevOps Error (${response.status}): ${
        errorData.message || response.statusText
      }`
    );
  }
  return response.json();
}

export async function getPRReviewDetails(
  params: PRReviewParams,
  pat: string
): Promise<PRReviewDetails> {
  debugger;
  const url = `https://dev.azure.com/${params.organization}/${
    params.project
  }/_apis/git/repositories/${encodeURIComponent(
    params.repository
  )}/pullRequests/${params.pullRequestId}?api-version=7.0&includeThreads=true`;

  console.log("Fetching PR details from URL:", url);
  console.log("With params:", params);

  const data = await fetchWithAuth(url, pat);

  return {
    pullRequestId: data.pullRequestId,
    title: data.title,
    description: data.description || "",
    createdBy: {
      displayName: data.createdBy?.displayName || "Unknown",
      uniqueName:
        data.createdBy?.uniqueName ||
        data.createdBy?.email ||
        "unknown@example.com",
    },
    creationDate: data.creationDate,
    sourceRefName: data.sourceRefName,
    targetRefName: data.targetRefName,
    status: data.status,
    mergeStatus: data.mergeStatus || "unknown",
    reviewers:
      data.reviewers?.map((r: any) => ({
        reviewer: {
          displayName: r.reviewer.displayName,
          uniqueName: r.reviewer.uniqueName,
        },
        vote: r.vote,
        isRequired: r.isRequired,
      })) || [],
    threads:
      data.threads?.map((thread: any) => ({
        id: thread.id,
        status: thread.status,
        comments:
          thread.comments?.map((comment: any) => ({
            id: comment.id,
            author: {
              displayName: comment.author.displayName,
              uniqueName: comment.author.uniqueName,
            },
            content: comment.content,
            threadContext: comment.threadContext,
            publishedDate: comment.publishedDate,
            lastUpdatedDate: comment.lastUpdatedDate,
            isDeleted: comment.isDeleted,
          })) || [],
        threadContext: thread.threadContext,
        publishedDate: thread.publishedDate,
        lastUpdatedDate: thread.lastUpdatedDate,
      })) || [],
    url: data.url,
    repository: {
      name: data.repository?.name || params.repository,
      url: data.repository?.url || "",
    },
    project: {
      name: data.repository?.project?.name || params.project,
      url: data.repository?.project?.url || "",
    },
  };
}

export async function submitPRVote(
  params: PRReviewParams,
  pat: string,
  vote: number,
  reviewerId?: string
): Promise<void> {
  const url = `https://dev.azure.com/${params.organization}/${
    params.project
  }/_apis/git/repositories/${encodeURIComponent(
    params.repository
  )}/pullRequests/${params.pullRequestId}/reviewers/${
    reviewerId || "me"
  }?api-version=7.0`;

  const voteBody = {
    vote: vote,
    isRequired: false,
  };

  await fetchWithAuth(url, pat, "PATCH", voteBody);
}

export async function createPRComment(
  params: PRReviewParams,
  pat: string,
  content: string,
  threadContext?: {
    filePath: string;
    lineNumber?: number;
  }
): Promise<PRReviewThread> {
  const url = `https://dev.azure.com/${params.organization}/${
    params.project
  }/_apis/git/repositories/${encodeURIComponent(
    params.repository
  )}/pullRequests/${params.pullRequestId}/threads?api-version=7.0`;

  const commentBody = {
    comments: [
      {
        content: content,
        commentType: 1, // 1 = text
      },
    ],
    status: "active",
    threadContext: threadContext
      ? {
          filePath: threadContext.filePath,
          rightFileStart: threadContext.lineNumber
            ? {
                line: threadContext.lineNumber,
                offset: 1,
              }
            : undefined,
          rightFileEnd: threadContext.lineNumber
            ? {
                line: threadContext.lineNumber,
                offset: 1,
              }
            : undefined,
        }
      : undefined,
  };

  const data = await fetchWithAuth(url, pat, "POST", commentBody);

  return {
    id: data.id,
    status: data.status,
    comments:
      data.comments?.map((comment: any) => ({
        id: comment.id,
        author: {
          displayName: comment.author.displayName,
          uniqueName: comment.author.uniqueName,
        },
        content: comment.content,
        threadContext: comment.threadContext,
        publishedDate: comment.publishedDate,
        lastUpdatedDate: comment.lastUpdatedDate,
        isDeleted: comment.isDeleted,
      })) || [],
    threadContext: data.threadContext,
    publishedDate: data.publishedDate,
    lastUpdatedDate: data.lastUpdatedDate,
  };
}

export async function replyToPRComment(
  params: PRReviewParams,
  pat: string,
  threadId: number,
  content: string
): Promise<PRReviewComment> {
  const url = `https://dev.azure.com/${params.organization}/${
    params.project
  }/_apis/git/repositories/${encodeURIComponent(
    params.repository
  )}/pullRequests/${
    params.pullRequestId
  }/threads/${threadId}/comments?api-version=7.0`;

  const replyBody = {
    content: content,
    commentType: 1, // 1 = text
  };

  const data = await fetchWithAuth(url, pat, "POST", replyBody);

  return {
    id: data.id,
    author: {
      displayName: data.author.displayName,
      uniqueName: data.author.uniqueName,
    },
    content: data.content,
    threadContext: data.threadContext,
    publishedDate: data.publishedDate,
    lastUpdatedDate: data.lastUpdatedDate,
    isDeleted: data.isDeleted,
  };
}

export async function updateThreadStatus(
  params: PRReviewParams,
  pat: string,
  threadId: number,
  status: "active" | "fixed" | "wontFix" | "closed" | "byDesign"
): Promise<void> {
  const url = `https://dev.azure.com/${params.organization}/${
    params.project
  }/_apis/git/repositories/${encodeURIComponent(
    params.repository
  )}/pullRequests/${params.pullRequestId}/threads/${threadId}?api-version=7.0`;

  const statusBody = {
    status: status,
  };

  await fetchWithAuth(url, pat, "PATCH", statusBody);
}

export async function getPRFiles(
  params: PRReviewParams,
  pat: string
): Promise<Array<{ path: string; changeType: string }>> {
  const url = `https://dev.azure.com/${params.organization}/${
    params.project
  }/_apis/git/repositories/${encodeURIComponent(
    params.repository
  )}/pullRequests/${params.pullRequestId}/changes?api-version=7.0`;

  const data = await fetchWithAuth(url, pat);

  return (data.changeEntries || data.value || data.changes || []).map(
    (change: any) => ({
      path: change.item?.path || change.path || "",
      changeType: change.changeType || "edit",
    })
  );
}

export async function getFileContent(
  params: PRReviewParams,
  pat: string,
  filePath: string,
  commitId?: string
): Promise<string> {
  const versionParam = commitId
    ? `&versionDescriptor.version=${commitId}&versionDescriptor.versionType=commit`
    : "";
  const url = `https://dev.azure.com/${params.organization}/${
    params.project
  }/_apis/git/repositories/${encodeURIComponent(
    params.repository
  )}/items?path=${encodeURIComponent(filePath)}${versionParam}&api-version=7.0`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${btoa(":" + pat)}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch file content: ${response.statusText}`);
  }

  const content = await response.text();

  // Handle binary files
  if (content.includes("\u0000")) {
    return "[Binary File - Content not available]";
  }

  // Truncate very large files
  if (content.length > 50000) {
    return (
      content.substring(0, 50000) +
      "\n... [TRUNCATED - File too large for display]"
    );
  }

  return content;
}

async function getLatestIterationChanges(
  params: PRReviewParams,
  pat: string
): Promise<{
  changes: any[];
  sourceCommitId: string | null;
  targetCommitId: string | null;
}> {
  const baseUrl = `https://dev.azure.com/${params.organization}/${
    params.project
  }/_apis/git/repositories/${encodeURIComponent(
    params.repository
  )}/pullRequests/${params.pullRequestId}`;
  const iterationsUrl = `${baseUrl}/iterations?api-version=7.0`;

  const iterationsData = await fetchWithAuth(iterationsUrl, pat);
  const iterations = iterationsData.value || [];

  if (iterations.length === 0) {
    return { changes: [], sourceCommitId: null, targetCommitId: null };
  }

  const latest = iterations[iterations.length - 1];
  const changesUrl = `${baseUrl}/iterations/${latest.id}/changes?api-version=7.0`;
  const changesData = await fetchWithAuth(changesUrl, pat);

  return {
    changes:
      changesData.changes ||
      changesData.changeEntries ||
      changesData.value ||
      [],
    sourceCommitId: latest.sourceRefCommit?.commitId || null,
    targetCommitId: latest.targetRefCommit?.commitId || null,
  };
}

export async function getPRFileDiffs(
  params: PRReviewParams,
  pat: string
): Promise<
  Array<{
    path: string;
    changeType: string;
    sourceContent?: string;
    targetContent?: string;
  }>
> {
  const baseUrl = `https://dev.azure.com/${params.organization}/${
    params.project
  }/_apis/git/repositories/${encodeURIComponent(
    params.repository
  )}/pullRequests/${params.pullRequestId}`;
  const url = `${baseUrl}/changes?api-version=7.0`;

  console.log("Fetching PR file diffs from URL:", url);

  let changes: any[] = [];
  let sourceCommitFallback: string | null = null;
  let targetCommitFallback: string | null = null;

  try {
    const data = await fetchWithAuth(url, pat);
    changes = data.changeEntries || data.value || data.changes || [];
    console.log(`Found ${changes.length} changed files`);
  } catch (error) {
    console.error("Failed to fetch PR file diffs:", error);
  }

  if (!changes.length) {
    try {
      const iterationData = await getLatestIterationChanges(params, pat);
      changes = iterationData.changes;
      sourceCommitFallback = iterationData.sourceCommitId;
      targetCommitFallback = iterationData.targetCommitId;
      console.log(
        `Found ${changes.length} changed files from latest iteration`
      );
    } catch (iterationError) {
      console.error(
        "Failed to fetch PR changes from latest iteration:",
        iterationError
      );
    }
  }

  if (!changes.length) {
    try {
      const basicFileList = await getPRFiles(params, pat);
      console.log(
        `Falling back to basic file list with ${basicFileList.length} files`
      );
      return basicFileList.map((file) => ({
        path: file.path,
        changeType: file.changeType,
        sourceContent: "",
        targetContent: "",
      }));
    } catch (fallbackError) {
      console.error("Failed to get even basic file list:", fallbackError);
      return [];
    }
  }

  // Fetch source and target content for each changed file
  const results = await Promise.all(
    changes.map(async (change: any) => {
      const path = change.item?.path || change.path || "";
      const changeType = change.changeType || "edit";

      let sourceContent = "";
      let targetContent = "";

      const sourceCommit =
        change.sourceCommitValue ||
        change.sourceCommit?.commitId ||
        sourceCommitFallback;
      const targetCommit =
        change.targetCommitValue ||
        change.targetCommit?.commitId ||
        targetCommitFallback;

      try {
        // Get source (base) content
        if (sourceCommit) {
          const sourceUrl = `https://dev.azure.com/${params.organization}/${
            params.project
          }/_apis/git/repositories/${encodeURIComponent(
            params.repository
          )}/items?path=${encodeURIComponent(
            path
          )}&versionDescriptor.version=${sourceCommit}&versionDescriptor.versionType=commit&api-version=7.0`;

          console.log("Fetching source content from:", sourceUrl);

          const sourceResponse = await fetch(sourceUrl, {
            headers: { Authorization: `Basic ${btoa(":" + pat)}` },
          });

          console.log(
            "Source response status:",
            sourceResponse.status,
            sourceResponse.statusText
          );

          if (sourceResponse.ok) {
            sourceContent = await sourceResponse.text();
            if (sourceContent.includes("\u0000")) {
              sourceContent = "[Binary File - Content not available]";
            } else if (sourceContent.length > 20000) {
              sourceContent =
                sourceContent.substring(0, 20000) + "\n... [TRUNCATED]";
            }
          } else {
            console.error(
              "Failed to fetch source content:",
              sourceResponse.status,
              sourceResponse.statusText
            );
          }
        }

        // Get target (current) content
        if (targetCommit) {
          const targetUrl = `https://dev.azure.com/${params.organization}/${
            params.project
          }/_apis/git/repositories/${encodeURIComponent(
            params.repository
          )}/items?path=${encodeURIComponent(
            path
          )}&versionDescriptor.version=${targetCommit}&versionDescriptor.versionType=commit&api-version=7.0`;

          console.log("Fetching target content from:", targetUrl);

          const targetResponse = await fetch(targetUrl, {
            headers: { Authorization: `Basic ${btoa(":" + pat)}` },
          });

          console.log(
            "Target response status:",
            targetResponse.status,
            targetResponse.statusText
          );

          if (targetResponse.ok) {
            targetContent = await targetResponse.text();
            if (targetContent.includes("\u0000")) {
              targetContent = "[Binary File - Content not available]";
            } else if (targetContent.length > 20000) {
              targetContent =
                targetContent.substring(0, 20000) + "\n... [TRUNCATED]";
            }
          } else {
            console.error(
              "Failed to fetch target content:",
              targetResponse.status,
              targetResponse.statusText
            );
          }
        }
      } catch (error) {
        console.error("Failed to fetch file contents:", error);
      }

      return {
        path,
        changeType,
        sourceContent,
        targetContent,
      };
    })
  );

  // Return all files, even if we couldn't fetch content for some
  // This allows users to see all changed files in the dropdown
  console.log(`Returning ${results.length} files (with or without content)`);
  return results;
}

export function getVoteStatus(vote: number): {
  text: string;
  color: string;
  icon: string;
} {
  switch (vote) {
    case 0:
      return { text: "No vote", color: "text-slate-400", icon: "fa-clock" };
    case 5:
      return {
        text: "Approved",
        color: "text-green-400",
        icon: "fa-check-circle",
      };
    case 10:
      return {
        text: "Approved with suggestions",
        color: "text-green-400",
        icon: "fa-check-circle",
      };
    case -5:
      return {
        text: "Waiting for author",
        color: "text-yellow-400",
        icon: "fa-hourglass-half",
      };
    case -10:
      return {
        text: "Rejected",
        color: "text-red-400",
        icon: "fa-times-circle",
      };
    default:
      return {
        text: "Unknown",
        color: "text-slate-400",
        icon: "fa-question-circle",
      };
  }
}

export function getThreadStatus(status: string): {
  text: string;
  color: string;
} {
  switch (status) {
    case "active":
      return { text: "Active", color: "text-blue-400" };
    case "fixed":
      return { text: "Fixed", color: "text-green-400" };
    case "wontFix":
      return { text: "Won't Fix", color: "text-slate-400" };
    case "closed":
      return { text: "Closed", color: "text-slate-400" };
    case "byDesign":
      return { text: "By Design", color: "text-purple-400" };
    default:
      return { text: status, color: "text-slate-400" };
  }
}

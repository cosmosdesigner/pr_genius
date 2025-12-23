import {
  PRCreateParams,
  PRCreateResult,
  PRReviewer,
  AzureDevOpsParams,
} from "../types.ts";

export function parsePRUrl(url: string): AzureDevOpsParams | null {
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

  const response = await fetch(url, options);

  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Unauthorized: Invalid PAT or insufficient permissions.");
    if (response.status === 403)
      throw new Error(
        'Forbidden: Your PAT might not have "Code (Read & Write)" scope.'
      );
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      `Azure DevOps Error (${response.status}): ${
        errorData.message || response.statusText
      }`
    );
  }
  return response.json();
}

export async function createPR(
  params: PRCreateParams,
  pat: string
): Promise<PRCreateResult> {
  const url = `https://dev.azure.com/${params.organization}/${params.project}/_apis/git/repositories/${params.repository}/pullRequests?api-version=7.0`;

  const prBody = {
    sourceRefName: `refs/heads/${params.sourceBranch}`,
    targetRefName: `refs/heads/${params.targetBranch}`,
    title: params.title,
    description: params.description,
    reviewers: [
      ...(params.requiredReviewers || []).map((email) => ({
        displayName: email,
        uniqueName: email,
        isRequired: true,
      })),
      ...(params.optionalReviewers || []).map((email) => ({
        displayName: email,
        uniqueName: email,
        isRequired: false,
      })),
    ],
    workItemRefs: (params.workItems || []).map((id) => ({
      id: id.toString(),
    })),
    autoCompleteSet: params.autoComplete || false,
    deleteSourceBranch: params.deleteSourceBranch || false,
    mergeStrategy: params.mergeStrategy || "squash",
  };

  const data = await fetchWithAuth(url, pat, "POST", prBody);

  return {
    pullRequestId: data.pullRequestId,
    url: data.url,
    title: data.title,
    status: data.status,
    createdBy: {
      displayName: data.createdBy?.displayName || "Unknown",
    },
    creationDate: data.creationDate,
    sourceRefName: data.sourceRefName,
    targetRefName: data.targetRefName,
    reviewers: data.reviewers?.map((r: any) => ({
      reviewer: {
        displayName: r.reviewer.displayName,
        uniqueName: r.reviewer.uniqueName,
      },
      vote: r.vote,
      isRequired: r.isRequired,
    })),
  };
}

export async function addReviewersToPR(
  organization: string,
  project: string,
  repository: string,
  pullRequestId: number,
  reviewers: string[],
  isRequired: boolean,
  pat: string
): Promise<void> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullRequests/${pullRequestId}/reviewers?api-version=7.0`;

  const reviewerBody = reviewers.map((email) => ({
    displayName: email,
    uniqueName: email,
    isRequired,
  }));

  await fetchWithAuth(url, pat, "POST", reviewerBody[0]); // Add one at a time
}

export async function linkWorkItemsToPR(
  organization: string,
  project: string,
  repository: string,
  pullRequestId: number,
  workItemIds: number[],
  pat: string
): Promise<void> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullRequests/${pullRequestId}/workitems?api-version=7.0`;

  const workItemBody = workItemIds.map((id) => ({
    id: id.toString(),
  }));

  await fetchWithAuth(url, pat, "POST", workItemBody[0]); // Add one at a time
}

export async function updatePRSettings(
  organization: string,
  project: string,
  repository: string,
  pullRequestId: number,
  settings: {
    autoComplete?: boolean;
    deleteSourceBranch?: boolean;
  },
  pat: string
): Promise<void> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullRequests/${pullRequestId}?api-version=7.0`;

  const updateBody: any = {};
  if (settings.autoComplete !== undefined) {
    updateBody.autoCompleteSet = settings.autoComplete;
  }
  if (settings.deleteSourceBranch !== undefined) {
    updateBody.deleteSourceBranch = settings.deleteSourceBranch;
  }

  await fetchWithAuth(url, pat, "PATCH", updateBody);
}

export async function getPRDetails(
  organization: string,
  project: string,
  repository: string,
  pullRequestId: number,
  pat: string
): Promise<PRCreateResult> {
  const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/pullRequests/${pullRequestId}?api-version=7.0`;

  const data = await fetchWithAuth(url, pat);

  return {
    pullRequestId: data.pullRequestId,
    url: data.url,
    title: data.title,
    status: data.status,
    createdBy: {
      displayName: data.createdBy?.displayName || "Unknown",
    },
    creationDate: data.creationDate,
    sourceRefName: data.sourceRefName,
    targetRefName: data.targetRefName,
    reviewers: data.reviewers?.map((r: any) => ({
      reviewer: {
        displayName: r.reviewer.displayName,
        uniqueName: r.reviewer.uniqueName,
      },
      vote: r.vote,
      isRequired: r.isRequired,
    })),
  };
}

export async function validateBranchExists(
  organization: string,
  project: string,
  repository: string,
  branchName: string,
  pat: string
): Promise<boolean> {
  try {
    const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/refs?api-version=7.0&filter=heads/${branchName}`;
    const data = await fetchWithAuth(url, pat);
    return data.value && data.value.length > 0;
  } catch {
    return false;
  }
}

export async function getRepositoryBranches(
  organization: string,
  project: string,
  repository: string,
  pat: string
): Promise<string[]> {
  try {
    const url = `https://dev.azure.com/${organization}/${project}/_apis/git/repositories/${repository}/refs?api-version=7.0&filter=heads`;
    const data = await fetchWithAuth(url, pat);
    return (data.value || [])
      .map((ref: any) => ref.name.replace("refs/heads/", ""))
      .filter((name: string) => name.length > 0);
  } catch {
    return [];
  }
}

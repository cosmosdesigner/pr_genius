import { AzureDevOpsParams, PRInfo, FileDiff } from "../types.ts";

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

async function fetchWithAuth(url: string, pat: string) {
  const headers = new Headers();
  headers.append("Authorization", `Basic ${btoa(":" + pat)}`);
  headers.append("Content-Type", "application/json");

  const response = await fetch(url, { headers });

  if (!response.ok) {
    if (response.status === 401)
      throw new Error("Unauthorized: Invalid PAT or insufficient permissions.");
    if (response.status === 403)
      throw new Error(
        'Forbidden: Your PAT might not have "Code (Read)" scope.'
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

export async function getPRDetails(
  params: AzureDevOpsParams,
  pat: string
): Promise<PRInfo> {
  debugger;
  const url = `https://dev.azure.com/${params.organization}/${params.project}/_apis/git/repositories/${params.repository}/pullRequests/${params.pullRequestId}?api-version=7.0`;
  const data = await fetchWithAuth(url, pat);
  return {
    title: data.title,
    description: data.description || "No description provided.",
    createdBy: data.createdBy?.displayName || "Unknown",
    sourceBranch: data.sourceRefName?.replace("refs/heads/", "") || "unknown",
    targetBranch: data.targetRefName?.replace("refs/heads/", "") || "unknown",
    status: data.status,
  };
}

export async function getPRMetadata(params: AzureDevOpsParams, pat: string) {
  let commitId: string | null = null;
  let changes: any[] = [];

  try {
    const iterationsUrl = `https://dev.azure.com/${params.organization}/${params.project}/_apis/git/repositories/${params.repository}/pullRequests/${params.pullRequestId}/iterations?api-version=7.0`;
    const iterationsData = await fetchWithAuth(iterationsUrl, pat);
    const iterationList = iterationsData.value || [];

    if (iterationList.length > 0) {
      const latest = iterationList[iterationList.length - 1];
      commitId = latest.sourceRefCommit?.commitId || null;

      const iterChangesUrl = `https://dev.azure.com/${params.organization}/${params.project}/_apis/git/repositories/${params.repository}/pullRequests/${params.pullRequestId}/iterations/${latest.id}/changes?api-version=7.0`;
      const iterChangesData = await fetchWithAuth(iterChangesUrl, pat);

      changes =
        iterChangesData.changes ||
        iterChangesData.changeEntries ||
        iterChangesData.value ||
        [];
    }
  } catch (e) {
    console.warn("Falling back to basic PR changes.");
  }

  if (changes.length === 0) {
    const changesUrl = `https://dev.azure.com/${params.organization}/${params.project}/_apis/git/repositories/${params.repository}/pullRequests/${params.pullRequestId}/changes?api-version=7.0`;
    const changesData = await fetchWithAuth(changesUrl, pat);
    changes =
      changesData.changeEntries ||
      changesData.value ||
      changesData.changes ||
      [];
  }

  return { commitId, changes };
}

export async function fetchBatchContents(
  params: AzureDevOpsParams,
  pat: string,
  changes: any[],
  commitId: string | null
): Promise<FileDiff[]> {
  return Promise.all(
    changes.map(async (change: any) => {
      const path =
        change.item?.path ||
        change.path ||
        (change.item && typeof change.item === "string" ? change.item : null);
      if (!path) return null;

      let content = "";
      const changeType = change.changeType || "edit";
      const skipTypes = ["delete", "none"];

      if (!skipTypes.includes(changeType.toLowerCase())) {
        try {
          const versionParam = commitId
            ? `&versionDescriptor.version=${commitId}&versionDescriptor.versionType=commit`
            : "";
          const url = `https://dev.azure.com/${params.organization}/${
            params.project
          }/_apis/git/repositories/${
            params.repository
          }/items?path=${encodeURIComponent(
            path
          )}${versionParam}&api-version=7.0`;

          const res = await fetch(url, {
            headers: { Authorization: `Basic ${btoa(":" + pat)}` },
          });
          if (res.ok) {
            content = await res.text();
            if (content.includes("\u0000")) {
              content = "[Binary File - Skipping analysis]";
            } else if (content.length > 20000) {
              content = content.substring(0, 20000) + "\n... [TRUNCATED]";
            }
          }
        } catch (err) {
          content = "[Error fetching content]";
        }
      }

      return {
        path,
        changeType,
        content,
        originalPath: change.sourceServerItem || change.originalPath,
      } as FileDiff;
    })
  ).then((res) => res.filter((f): f is FileDiff => f !== null));
}

"use strict";
/**
 * GitHub REST + Git Data API client.
 * All writes go to a feature branch; nothing touches main directly.
 */

const OWNER = "Knipsarn";
const REPO = "voice-agent";
const BASE_BRANCH = "main";
const API = "https://api.github.com";

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    "User-Agent": "voice-platform-patch-agent/1.0",
  };
}

async function ghFetch(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: headers(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// Returns flat list of all file paths in the repo
async function getRepoTree(token) {
  const branch = await ghFetch(token, "GET", `/repos/${OWNER}/${REPO}/branches/${BASE_BRANCH}`);
  const sha = branch.commit.sha;
  const tree = await ghFetch(token, "GET", `/repos/${OWNER}/${REPO}/git/trees/${sha}?recursive=1`);
  return {
    baseSha: sha,
    files: (tree.tree || []).filter((f) => f.type === "blob").map((f) => f.path),
  };
}

// Returns utf-8 content of a file
async function readFile(token, path, ref = BASE_BRANCH) {
  const data = await ghFetch(token, "GET", `/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}?ref=${ref}`);
  if (!data.content) throw new Error(`No content for ${path}`);
  return Buffer.from(data.content, "base64").toString("utf-8");
}

// Search code in the repo using GitHub code search
async function searchCode(token, query) {
  const q = encodeURIComponent(`${query} repo:${OWNER}/${REPO}`);
  const data = await ghFetch(token, "GET", `/search/code?q=${q}&per_page=10`);
  return (data.items || []).map((i) => ({ path: i.path, score: i.score }));
}

/**
 * Commit multiple file changes to a new branch in a single commit.
 * changes: Array of { path, content }
 * Returns { branchName, prUrl, prNumber } after creating the PR.
 */
async function pushBranchAndPR(token, { branchName, changes, commitMessage, prTitle, prBody }) {
  // 1. Get base commit SHA
  const baseRef = await ghFetch(token, "GET", `/repos/${OWNER}/${REPO}/git/ref/heads/${BASE_BRANCH}`);
  const baseSha = baseRef.object.sha;
  const baseCommit = await ghFetch(token, "GET", `/repos/${OWNER}/${REPO}/git/commits/${baseSha}`);
  const baseTreeSha = baseCommit.tree.sha;

  // 2. Create blobs for each changed file
  const treeItems = [];
  for (const { path, content } of changes) {
    const blob = await ghFetch(token, "POST", `/repos/${OWNER}/${REPO}/git/blobs`, {
      content: Buffer.from(content).toString("base64"),
      encoding: "base64",
    });
    treeItems.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }

  // 3. Create tree
  const newTree = await ghFetch(token, "POST", `/repos/${OWNER}/${REPO}/git/trees`, {
    base_tree: baseTreeSha,
    tree: treeItems,
  });

  // 4. Create commit
  const newCommit = await ghFetch(token, "POST", `/repos/${OWNER}/${REPO}/git/commits`, {
    message: commitMessage,
    tree: newTree.sha,
    parents: [baseSha],
  });

  // 5. Create branch
  await ghFetch(token, "POST", `/repos/${OWNER}/${REPO}/git/refs`, {
    ref: `refs/heads/${branchName}`,
    sha: newCommit.sha,
  });

  // 6. Create PR
  const pr = await ghFetch(token, "POST", `/repos/${OWNER}/${REPO}/pulls`, {
    title: prTitle,
    body: prBody,
    head: branchName,
    base: BASE_BRANCH,
    draft: false,
  });

  return { branchName, prUrl: pr.html_url, prNumber: pr.number };
}

/**
 * Squash-merge an open PR. Used for auto-deploying low-risk patches.
 */
async function mergePR(token, prNumber, { commitTitle, commitMessage } = {}) {
  return ghFetch(token, "PUT", `/repos/${OWNER}/${REPO}/pulls/${prNumber}/merge`, {
    merge_method: "squash",
    commit_title: commitTitle || `auto-patch: merge PR #${prNumber}`,
    commit_message: commitMessage || "",
  });
}

module.exports = { getRepoTree, readFile, searchCode, pushBranchAndPR, mergePR };

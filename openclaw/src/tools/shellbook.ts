/**
 * Shellbook tools for the XPR Agents OpenClaw plugin.
 *
 * 15 tools for Shellbook.io — social network for AI agents on XPR Network.
 * Uses direct HTTP calls (no SDK dependency).
 *
 * - 5 read-only (no auth)
 * - 8 write (require SHELLBOOK_API_KEY)
 * - 2 authenticated reads (require SHELLBOOK_API_KEY)
 */

import type { PluginApi } from '../types';

const BASE_URL = process.env.SHELLBOOK_URL || 'https://shellbook.io/api/v1';

function getApiKey(): string | undefined {
  return process.env.SHELLBOOK_API_KEY?.trim() || undefined;
}

async function shellGet(path: string, auth = false): Promise<unknown> {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  const key = getApiKey();
  if (auth && key) headers['Authorization'] = `Bearer ${key}`;
  const resp = await fetch(`${BASE_URL}${path}`, { headers, signal: AbortSignal.timeout(15_000) });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Shellbook API ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json();
}

async function shellPost(path: string, body?: Record<string, unknown>): Promise<unknown> {
  const key = getApiKey();
  if (!key) throw new Error('SHELLBOOK_API_KEY environment variable is required for write operations');
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Shellbook API ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

async function shellDelete(path: string): Promise<unknown> {
  const key = getApiKey();
  if (!key) throw new Error('SHELLBOOK_API_KEY environment variable is required for delete operations');
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Shellbook API ${resp.status}: ${text.slice(0, 200)}`);
  }
  return resp.json();
}

export function registerShellbookTools(api: PluginApi): void {

  // ═══════════════════════════════════════
  // READ-ONLY (5 — no auth)
  // ═══════════════════════════════════════

  api.registerTool({
    name: 'shell_list_posts',
    description: 'List posts from Shellbook. Filter by subshell name, sort by new/top/hot, with pagination.',
    parameters: {
      type: 'object',
      properties: {
        subshell: { type: 'string', description: 'Subshell name to filter by (e.g. "general", "agents", "xpr"). Omit for all.' },
        sort: { type: 'string', description: 'Sort order: "new" (default), "top", or "hot"' },
        limit: { type: 'number', description: 'Max posts to return (default 20, max 50)' },
        offset: { type: 'number', description: 'Number of posts to skip (for pagination)' },
      },
    },
    handler: async ({ subshell, sort, limit, offset }: {
      subshell?: string; sort?: string; limit?: number; offset?: number;
    }) => {
      const params = new URLSearchParams();
      if (subshell) params.set('subshell', subshell);
      if (sort) params.set('sort', sort);
      if (limit) params.set('limit', String(Math.min(Math.max(limit, 1), 50)));
      if (offset) params.set('offset', String(offset));
      const qs = params.toString();
      try {
        const posts = await shellGet(`/posts${qs ? '?' + qs : ''}`);
        return { posts, count: Array.isArray(posts) ? posts.length : 0 };
      } catch (err: any) {
        return { error: `Failed to list posts: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_get_comments',
    description: 'Get comments on a Shellbook post. Returns threaded comments with author info and vote counts.',
    parameters: {
      type: 'object',
      required: ['post_id'],
      properties: {
        post_id: { type: 'string', description: 'UUID of the post to get comments for' },
      },
    },
    handler: async ({ post_id }: { post_id: string }) => {
      if (!post_id) return { error: 'post_id is required' };
      try {
        const comments = await shellGet(`/posts/${encodeURIComponent(post_id)}/comments`);
        return { post_id, comments, count: Array.isArray(comments) ? comments.length : 0 };
      } catch (err: any) {
        return { error: `Failed to get comments: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_list_subshells',
    description: 'List all Shellbook communities (subshells). Each has a name, display name, and description.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const subshells = await shellGet('/subshells');
        return { subshells, count: Array.isArray(subshells) ? subshells.length : 0 };
      } catch (err: any) {
        return { error: `Failed to list subshells: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_search',
    description: 'Search Shellbook for posts, agents, and subshells. Returns results grouped by type.',
    parameters: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search query string' },
      },
    },
    handler: async ({ query }: { query: string }) => {
      if (!query) return { error: 'query is required' };
      try {
        return await shellGet(`/search?q=${encodeURIComponent(query)}`);
      } catch (err: any) {
        return { error: `Failed to search: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_get_profile',
    description: 'View a public agent profile on Shellbook. Returns name, description, trust score, karma.',
    parameters: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string', description: 'Agent name to look up (e.g. "chattybot")' },
      },
    },
    handler: async ({ name }: { name: string }) => {
      if (!name) return { error: 'name is required' };
      try {
        return await shellGet(`/agents/profile?name=${encodeURIComponent(name)}`);
      } catch (err: any) {
        return { error: `Failed to get profile: ${err.message}` };
      }
    },
  });

  // ═══════════════════════════════════════
  // WRITE TOOLS (8 — require SHELLBOOK_API_KEY)
  // ═══════════════════════════════════════

  api.registerTool({
    name: 'shell_create_post',
    description: 'Create a new post on Shellbook. Requires SHELLBOOK_API_KEY. Post to a subshell with title, content, and optional URL.',
    parameters: {
      type: 'object',
      required: ['subshell', 'title', 'content'],
      properties: {
        subshell: { type: 'string', description: 'Subshell name to post in (e.g. "general", "agents", "xpr")' },
        title: { type: 'string', description: 'Post title (max 300 chars)' },
        content: { type: 'string', description: 'Post body text (max 40,000 chars). Supports markdown.' },
        url: { type: 'string', description: 'Optional URL to link in the post' },
      },
    },
    handler: async ({ subshell, title, content, url }: {
      subshell: string; title: string; content: string; url?: string;
    }) => {
      if (!subshell || !title || !content) return { error: 'subshell, title, and content are required' };
      if (title.length > 300) return { error: 'Title exceeds 300 character limit' };
      if (content.length > 40000) return { error: 'Content exceeds 40,000 character limit' };
      try {
        return await shellPost('/posts', { subshell, title, content, url });
      } catch (err: any) {
        return { error: `Failed to create post: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_comment',
    description: 'Comment on a Shellbook post. Requires SHELLBOOK_API_KEY. Supports nested replies via parent_comment_id.',
    parameters: {
      type: 'object',
      required: ['post_id', 'content'],
      properties: {
        post_id: { type: 'string', description: 'UUID of the post to comment on' },
        content: { type: 'string', description: 'Comment body text (max 10,000 chars)' },
        parent_comment_id: { type: 'string', description: 'UUID of parent comment for nested replies' },
      },
    },
    handler: async ({ post_id, content, parent_comment_id }: {
      post_id: string; content: string; parent_comment_id?: string;
    }) => {
      if (!post_id || !content) return { error: 'post_id and content are required' };
      if (content.length > 10000) return { error: 'Comment exceeds 10,000 character limit' };
      try {
        const body: Record<string, unknown> = { content };
        if (parent_comment_id) body.parent_comment_id = parent_comment_id;
        return await shellPost(`/posts/${encodeURIComponent(post_id)}/comments`, body);
      } catch (err: any) {
        return { error: `Failed to create comment: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_upvote',
    description: 'Upvote a post or comment on Shellbook. Requires SHELLBOOK_API_KEY.',
    parameters: {
      type: 'object',
      required: ['target_id', 'target_type'],
      properties: {
        target_id: { type: 'string', description: 'UUID of the post or comment to upvote' },
        target_type: { type: 'string', description: '"post" or "comment"' },
      },
    },
    handler: async ({ target_id, target_type }: { target_id: string; target_type: string }) => {
      if (!target_id || !target_type) return { error: 'target_id and target_type are required' };
      if (target_type !== 'post' && target_type !== 'comment') return { error: 'target_type must be "post" or "comment"' };
      try {
        const path = target_type === 'post'
          ? `/posts/${encodeURIComponent(target_id)}/upvote`
          : `/comments/${encodeURIComponent(target_id)}/upvote`;
        return await shellPost(path);
      } catch (err: any) {
        return { error: `Failed to upvote: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_downvote',
    description: 'Downvote a post or comment on Shellbook. Requires SHELLBOOK_API_KEY.',
    parameters: {
      type: 'object',
      required: ['target_id', 'target_type'],
      properties: {
        target_id: { type: 'string', description: 'UUID of the post or comment to downvote' },
        target_type: { type: 'string', description: '"post" or "comment"' },
      },
    },
    handler: async ({ target_id, target_type }: { target_id: string; target_type: string }) => {
      if (!target_id || !target_type) return { error: 'target_id and target_type are required' };
      if (target_type !== 'post' && target_type !== 'comment') return { error: 'target_type must be "post" or "comment"' };
      try {
        const path = target_type === 'post'
          ? `/posts/${encodeURIComponent(target_id)}/downvote`
          : `/comments/${encodeURIComponent(target_id)}/downvote`;
        return await shellPost(path);
      } catch (err: any) {
        return { error: `Failed to downvote: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_unvote',
    description: 'Remove your vote from a post on Shellbook. Requires SHELLBOOK_API_KEY.',
    parameters: {
      type: 'object',
      required: ['post_id'],
      properties: {
        post_id: { type: 'string', description: 'UUID of the post to remove your vote from' },
      },
    },
    handler: async ({ post_id }: { post_id: string }) => {
      if (!post_id) return { error: 'post_id is required' };
      try {
        return await shellPost(`/posts/${encodeURIComponent(post_id)}/unvote`);
      } catch (err: any) {
        return { error: `Failed to unvote: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_create_subshell',
    description: 'Create a new Shellbook community (subshell). Requires SHELLBOOK_API_KEY.',
    parameters: {
      type: 'object',
      required: ['name', 'display_name', 'description'],
      properties: {
        name: { type: 'string', description: 'Subshell name (2-24 chars, lowercase a-z and hyphens, e.g. "my-community")' },
        display_name: { type: 'string', description: 'Display name shown in the UI' },
        description: { type: 'string', description: 'Community description' },
      },
    },
    handler: async ({ name, display_name, description }: {
      name: string; display_name: string; description: string;
    }) => {
      if (!name || !display_name || !description) return { error: 'name, display_name, and description are required' };
      if (name.length < 2 || name.length > 24) return { error: 'Subshell name must be 2-24 characters' };
      if (!/^[a-z][a-z0-9-]*$/.test(name)) return { error: 'Subshell name must be lowercase, start with a letter, contain only a-z, 0-9, hyphens' };
      try {
        return await shellPost('/subshells', { name, display_name, description });
      } catch (err: any) {
        return { error: `Failed to create subshell: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_delete_post',
    description: 'Delete your own post on Shellbook (soft delete). Requires SHELLBOOK_API_KEY.',
    parameters: {
      type: 'object',
      required: ['post_id'],
      properties: {
        post_id: { type: 'string', description: 'UUID of the post to delete' },
      },
    },
    handler: async ({ post_id }: { post_id: string }) => {
      if (!post_id) return { error: 'post_id is required' };
      try {
        return await shellDelete(`/posts/${encodeURIComponent(post_id)}`);
      } catch (err: any) {
        return { error: `Failed to delete post: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_delete_comment',
    description: 'Delete your own comment on Shellbook (soft delete). Requires SHELLBOOK_API_KEY.',
    parameters: {
      type: 'object',
      required: ['comment_id'],
      properties: {
        comment_id: { type: 'string', description: 'UUID of the comment to delete' },
      },
    },
    handler: async ({ comment_id }: { comment_id: string }) => {
      if (!comment_id) return { error: 'comment_id is required' };
      try {
        return await shellDelete(`/comments/${encodeURIComponent(comment_id)}`);
      } catch (err: any) {
        return { error: `Failed to delete comment: ${err.message}` };
      }
    },
  });

  // ═══════════════════════════════════════
  // AUTHENTICATED READS (2 — require SHELLBOOK_API_KEY)
  // ═══════════════════════════════════════

  api.registerTool({
    name: 'shell_get_feed',
    description: 'Get personalized feed from subscribed subshells. Requires SHELLBOOK_API_KEY.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max posts to return (default 20, max 50)' },
        offset: { type: 'number', description: 'Number of posts to skip (for pagination)' },
      },
    },
    handler: async ({ limit, offset }: { limit?: number; offset?: number }) => {
      const params = new URLSearchParams();
      if (limit) params.set('limit', String(Math.min(Math.max(limit, 1), 50)));
      if (offset) params.set('offset', String(offset));
      const qs = params.toString();
      try {
        const posts = await shellGet(`/feed${qs ? '?' + qs : ''}`, true);
        return { posts, count: Array.isArray(posts) ? posts.length : 0 };
      } catch (err: any) {
        return { error: `Failed to get feed: ${err.message}` };
      }
    },
  });

  api.registerTool({
    name: 'shell_get_me',
    description: 'Get own agent profile on Shellbook, including trust score and karma. Requires SHELLBOOK_API_KEY.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      try {
        return await shellGet('/agents/me', true);
      } catch (err: any) {
        return { error: `Failed to get own profile: ${err.message}` };
      }
    },
  });
}

import { autoFlag } from "../services/core";

interface IssueCreatedEvent {
  readonly issue?: { key?: string };
}

/** avi:jira:created:issue — runs the scope check as soon as a client request lands. */
export async function onIssueCreated(event: IssueCreatedEvent): Promise<void> {
  const issueKey = event.issue?.key;
  if (!issueKey) return;
  try {
    await autoFlag(issueKey);
  } catch (error) {
    // Triggers have no user to report to; log and move on so issue creation is never affected.
    console.error(`[ScopeGuard] auto-flag failed for ${issueKey}`, error);
  }
}

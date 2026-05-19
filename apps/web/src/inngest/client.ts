import { Inngest } from "inngest";

export const PROJECT_SUBMITTED_EVENT = "project/submitted" as const;
export const KIE_CALLBACK_RECEIVED_EVENT = "kie/callback.received" as const;
export const TESTING_RUN_QUEUED_EVENT = "testing/run.queued" as const;

export interface ProjectSubmittedEventData {
  imageCount: number;
  organizationId: string;
  projectId: string;
  submittedBy: string;
}

export interface KieCallbackReceivedEventData {
  providerJobId: string;
  resultUrls: string[];
  taskId: string;
}

export interface TestingRunQueuedEventData {
  queuedBy: string;
  runId: string;
}

export const inngest = new Inngest({
  id: "interior-pro",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

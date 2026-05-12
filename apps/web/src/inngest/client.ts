import { Inngest } from "inngest";

export const PROJECT_SUBMITTED_EVENT = "project/submitted" as const;

export interface ProjectSubmittedEventData {
  imageCount: number;
  organizationId: string;
  projectId: string;
  submittedBy: string;
}

export const inngest = new Inngest({
  id: "interior-pro",
  eventKey: process.env.INNGEST_EVENT_KEY,
});

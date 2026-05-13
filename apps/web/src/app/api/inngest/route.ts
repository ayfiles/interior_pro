import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { kieCallbackProcessor } from "@/inngest/functions/kie-callback-processor";
import { projectPipeline } from "@/inngest/functions/project-pipeline";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [projectPipeline, kieCallbackProcessor],
});

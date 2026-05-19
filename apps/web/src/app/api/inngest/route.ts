import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { kieCallbackProcessor } from "@/inngest/functions/kie-callback-processor";
import { projectPipeline } from "@/inngest/functions/project-pipeline";
import { testingRunExecutor } from "@/inngest/functions/testing-runner";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [projectPipeline, kieCallbackProcessor, testingRunExecutor],
});

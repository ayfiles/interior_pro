export const PIPELINE_MAX_RETRIES = Number(process.env.PIPELINE_MAX_RETRIES ?? 3);
export const PIPELINE_MAX_COST_PER_IMAGE = Number(
  process.env.PIPELINE_MAX_COST_PER_IMAGE ?? 1.5,
);
export const PIPELINE_MAX_COST_PER_JOB = Number(
  process.env.PIPELINE_MAX_COST_PER_JOB ?? 15,
);
export const PIPELINE_VALIDATION_IMAGE_SIZE = Number(
  process.env.PIPELINE_VALIDATION_IMAGE_SIZE ?? 1024,
);
export const PIPELINE_VALIDATOR_CASCADE_ENABLED =
  (process.env.PIPELINE_VALIDATOR_CASCADE_ENABLED ?? "true").toLowerCase() ===
  "true";

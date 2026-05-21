-- Track every generation attempt for analysis
CREATE TABLE IF NOT EXISTS pipeline_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  image_id UUID NOT NULL,
  attempt_number INT NOT NULL,
  seed BIGINT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('ACCEPT', 'ACCEPT_WITH_WARNING', 'REJECT')),
  critical_failures TEXT[],
  -- Validator cascade detail (§7)
  gemini_response JSONB NOT NULL,
  claude_response JSONB,                       -- null if Stage 1 REJECT or cascade off
  cascade_ran BOOLEAN NOT NULL DEFAULT false,
  generation_cost NUMERIC(10, 4) NOT NULL,
  validation_cost NUMERIC(10, 4) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_attempts_job ON pipeline_attempts(job_id);
CREATE INDEX idx_pipeline_attempts_image ON pipeline_attempts(image_id);
CREATE INDEX idx_pipeline_attempts_decision ON pipeline_attempts(decision);

-- Track final outcome per image (success or dropped)
CREATE TABLE IF NOT EXISTS pipeline_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  image_id UUID NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('success', 'dropped')),
  drop_reason TEXT,
  total_attempts INT NOT NULL,
  total_cost NUMERIC(10, 4) NOT NULL,
  final_output_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_outcomes_job ON pipeline_outcomes(job_id);
CREATE INDEX idx_pipeline_outcomes_status ON pipeline_outcomes(status);

ALTER TABLE pipeline_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_outcomes ENABLE ROW LEVEL SECURITY;

-- Service role only — these are written from the worker, never from the browser.

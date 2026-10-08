//! Stage timings for preparation before ComfyUI acknowledges a prompt.
//!
//! Keep these separate from sampling time: a slow upload, schema request or
//! filesystem lookup happens before there is a ComfyUI prompt ID to diagnose.

use std::time::Instant;

pub(crate) struct GenerationTiming {
    request_id: uuid::Uuid,
    transport: &'static str,
    mode: String,
    started: Instant,
    stage_started: Instant,
    stage: &'static str,
    finished: bool,
}

impl GenerationTiming {
    pub(crate) fn new(transport: &'static str, mode: &str) -> Self {
        let now = Instant::now();
        let request_id = uuid::Uuid::new_v4();
        log::info!(
            "[generate] preparation started request={request_id} transport={transport} mode={mode}"
        );
        Self {
            request_id,
            transport,
            mode: mode.to_owned(),
            started: now,
            stage_started: now,
            stage: "validation",
            finished: false,
        }
    }

    pub(crate) fn stage(&mut self, next: &'static str) {
        self.log_completed_stage();
        self.stage = next;
        self.stage_started = Instant::now();
        log::info!(
            "[generate] preparation stage started request={} transport={} mode={} stage={}",
            self.request_id,
            self.transport,
            self.mode,
            self.stage,
        );
    }

    pub(crate) fn finish(&mut self) {
        self.log_completed_stage();
        self.finished = true;
    }

    fn log_completed_stage(&self) {
        log::info!(
            "[generate] preparation request={} transport={} mode={} stage={} elapsed_ms={} total_ms={}",
            self.request_id,
            self.transport,
            self.mode,
            self.stage,
            self.stage_started.elapsed().as_millis(),
            self.started.elapsed().as_millis(),
        );
    }
}

impl Drop for GenerationTiming {
    fn drop(&mut self) {
        if !self.finished {
            log::warn!(
                "[generate] preparation stopped request={} transport={} mode={} stage={} elapsed_ms={} total_ms={}",
                self.request_id,
                self.transport,
                self.mode,
                self.stage,
                self.stage_started.elapsed().as_millis(),
                self.started.elapsed().as_millis(),
            );
        }
    }
}

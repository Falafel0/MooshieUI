//! Every-step alternation stays in prompt text until the final CLIP graph pass.
//! No new IPC fields: scheduled/regional/refinement prompts use the same syntax.
use super::WorkflowResult;
use crate::comfyui::types::GenerationParams;
use serde_json::{json, Value};

pub const SUPPORTED_SAMPLERS: &[&str] = &[
    "euler",
    "euler_ancestral",
    "euler_cfg_pp",
    "euler_ancestral_cfg_pp",
    "dpmpp_2m",
    "dpmpp_2m_cfg_pp",
    "dpmpp_2m_sde",
    "dpmpp_2m_sde_gpu",
    "dpmpp_2m_sde_heun",
    "dpmpp_2m_sde_heun_gpu",
    "dpmpp_3m_sde",
    "dpmpp_3m_sde_gpu",
    "lcm",
    "lms",
    "ddpm",
    "er_sde",
    "res_multistep",
    "res_multistep_cfg_pp",
    "res_multistep_ancestral",
    "res_multistep_ancestral_cfg_pp",
];

fn escaped(bytes: &[u8], at: usize) -> bool {
    let mut i = at;
    while i > 0 && bytes[i - 1] == b'\\' {
        i -= 1;
    }
    (at - i) % 2 == 1
}

/// Keep this scanner in lockstep with promptAlternation.ts and the Python node.
/// Nested, empty, unclosed, escaped and >16-choice blocks remain literal text.
pub fn option_counts(raw: &str) -> Vec<usize> {
    let bytes = raw.as_bytes();
    let mut counts = Vec::new();
    let mut start = 0;
    while start < bytes.len() {
        if bytes[start] != b'[' {
            start += 1;
            continue;
        }
        let mut depth = 1;
        let mut nested = false;
        let mut option_start = start + 1;
        let mut end = start + 1;
        let mut choices = Vec::new();
        while end < bytes.len() {
            if !escaped(bytes, end) {
                match bytes[end] {
                    b'[' => {
                        depth += 1;
                        nested = true;
                    }
                    b']' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    b'|' if depth == 1 => {
                        choices.push(raw[option_start..end].trim());
                        option_start = end + 1;
                    }
                    _ => (),
                }
            }
            end += 1;
        }
        if end == bytes.len() {
            break;
        }
        choices.push(raw[option_start..end].trim());
        if !escaped(bytes, start)
            && !nested
            && (2..=16).contains(&choices.len())
            && choices.iter().all(|part| !part.is_empty())
        {
            counts.push(choices.len());
        }
        start = end + 1;
    }
    counts
}

fn gcd(mut a: usize, mut b: usize) -> usize {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

fn collect_prompts<'a>(value: &'a Value, prompts: &mut Vec<&'a str>) {
    match value {
        Value::Object(map) => {
            for (key, item) in map {
                if key.contains("prompt") || key == "text" || key == "negative_text" {
                    if let Some(text) = item.as_str() {
                        prompts.push(text);
                    }
                }
                collect_prompts(item, prompts);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_prompts(item, prompts);
            }
        }
        _ => (),
    }
}

pub fn validate(params: &GenerationParams) -> Result<(), String> {
    let value = serde_json::to_value(params).map_err(|e| e.to_string())?;
    let mut prompts = Vec::new();
    collect_prompts(&value, &mut prompts);
    let active = prompts.iter().any(|text| !option_counts(text).is_empty());
    if !active {
        return Ok(());
    }
    if params.mode == "video"
        || params.mode == "image_edit"
        || !matches!(
            params.model_architecture.as_str(),
            "sd15"
                | "sdxl"
                | "illustrious"
                | "pony"
                | "mugen"
                | "anima"
                | "sd3"
                | "flux"
                | "flux1d"
                | "flux1s"
                | "flux1krea"
                | "auraflow"
        )
    {
        return Err("Every-step [a|b] alternation requires a supported ComfyUI image model with standard CLIP conditioning; this model/mode has no alternation adapter. Escape \\[ to keep it literal.".into());
    }
    if !SUPPORTED_SAMPLERS.contains(&params.sampler_name.as_str()) {
        return Err("Every-step [a|b] alternation needs a fixed-step, single-evaluation sampler (for example euler, euler_ancestral, dpmpp_2m or er_sde). Adaptive/multi-evaluation samplers are not supported.".into());
    }
    if params.style_transfer_enabled {
        return Err("Every-step [a|b] alternation has no RF-inversion style-transfer adapter. Disable style transfer before sampling an alternating prompt.".into());
    }
    if params.anima_teacache_enabled
        || params.anima_tools.as_ref().is_some_and(|p| p.enabled)
        || params
            .anima_artist_mixer
            .as_ref()
            .is_some_and(|p| p.enabled)
    {
        return Err("Every-step [a|b] alternation cannot be combined with Anima TeaCache, the structured composer or artist mixer. Disable them so every step uses its actual branch conditioning.".into());
    }
    // A resumed sigma tail has a new schedule. Until its absolute phase is
    // explicitly carried through, reject instead of resetting phase silently.
    if params.pause_at_step.is_some() || !params.resume_stages.is_empty() || params.stage.is_some()
    {
        return Err(
            "Every-step [a|b] alternation is not yet supported for pause/resume sampling.".into(),
        );
    }
    for text in prompts {
        let mut cycle = 1;
        for count in option_counts(text) {
            cycle = cycle / gcd(cycle, count) * count;
            if cycle > 64 {
                return Err("This prompt's alternation cycle exceeds 64 conditioning variants. Use fewer branch counts (matching branch counts share encodes).".into());
            }
        }
    }
    Ok(())
}

/// Run after all regional, upscale and detail encodes have been inserted.
/// Replace the encode in place so ranges, masks, guidance and ControlNet keep
/// their existing connections/metadata. Patch each sampling MODEL source once.
pub fn inject(result: &mut WorkflowResult) {
    let mut active = false;
    for node in result.workflow.values_mut() {
        if node["class_type"] == "CLIPTextEncode" {
            if let Some(text) = node["inputs"]["text"].as_str() {
                if !option_counts(text).is_empty() {
                    node["class_type"] = json!("MooshieAlternatingTextEncode");
                    active = true;
                }
            }
        }
    }
    if !active {
        return;
    }
    let consumers: Vec<_> = result
        .workflow
        .iter()
        .filter_map(|(id, node)| {
            let kind = node["class_type"].as_str().unwrap_or("");
            if kind.starts_with("KSampler")
                || kind.starts_with("SamplerCustom")
                || matches!(
                    kind,
                    "CFGGuider" | "BasicGuider" | "MooshieFaceDetailer" | "MooshieSegmentDetailer"
                )
            {
                node["inputs"]
                    .get("model")
                    .filter(|v| v.is_array())
                    .map(|model| (id.clone(), model.clone()))
            } else {
                None
            }
        })
        .collect();
    let mut patched: Vec<(Value, String)> = Vec::new();
    for (consumer, model) in consumers {
        let patch_id = if let Some((_, id)) = patched.iter().find(|(source, _)| *source == model) {
            id.clone()
        } else {
            let id = result.next_id.to_string();
            result.next_id += 1;
            result.workflow.insert(
                id.clone(),
                json!({
                    "class_type": "MooshiePromptAlternation",
                    "inputs": { "model": model }
                }),
            );
            patched.push((model, id.clone()));
            id
        };
        result.workflow.get_mut(&consumer).unwrap()["inputs"]["model"] = json!([patch_id, 0]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::templates::{build_workflow, graph_test_util};

    #[test]
    fn res_and_cfg_pp_samplers_build_scheduled_artist_alternation_without_changing_sampler() {
        for sampler in [
            "res_multistep",
            "res_multistep_cfg_pp",
            "res_multistep_ancestral",
            "res_multistep_ancestral_cfg_pp",
            "euler_cfg_pp",
            "euler_ancestral_cfg_pp",
            "dpmpp_2m_cfg_pp",
        ] {
            let mut params = graph_test_util::params("txt2img", "anima");
            params.sampler_name = sampler.into();
            params.positive_prompt =
                "<fromto[0.875]:[(@mik uneki:1.35)|(@artist:1.25)]||(painting:2.0)>".into();
            assert!(validate(&params).is_ok(), "{sampler}");
            let workflow = build_workflow(&params, 42, false);
            let encodes = graph_test_util::nodes(&workflow, "MooshieAlternatingTextEncode");
            assert!(
                !encodes.is_empty(),
                "{sampler}: alternation must be encoded"
            );
            let patches = graph_test_util::nodes(&workflow, "MooshiePromptAlternation");
            assert!(!patches.is_empty(), "{sampler}: model must be patched");
            let samplers = graph_test_util::nodes(&workflow, "KSampler");
            assert!(!samplers.is_empty(), "{sampler}");
            for (_, node) in samplers {
                assert_eq!(node["inputs"]["sampler_name"], sampler);
                let model_id = node["inputs"]["model"][0].as_str().unwrap();
                assert_eq!(workflow[model_id]["class_type"], "MooshiePromptAlternation");
            }
        }
    }

    #[test]
    fn multi_evaluation_and_adaptive_samplers_still_reject_alternation() {
        let mut params = graph_test_util::params("txt2img", "anima");
        params.positive_prompt = "[artist a|artist b]".into();
        for sampler in ["heun", "dpmpp_2s_ancestral_cfg_pp", "dpm_adaptive"] {
            params.sampler_name = sampler.into();
            assert!(validate(&params).unwrap_err().contains("single-evaluation"));
        }
        params.positive_prompt = "ordinary prompt".into();
        assert!(validate(&params).is_ok());
    }
}
